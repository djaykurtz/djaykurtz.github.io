import {
  changedPosition, feedback, parseWords, puzzleDate, selectPuzzle, advanceJourney,
  abandonJourney, journeyFinished, journeyMoves, requestTicketHint, singleLetter, validateCatalog,
} from "./engine.js";
import { freshState, loadTicket, saveTicket, storageKey, validateState } from "./storage.js";
import { RouteClient } from "./route-client.js";
import { Journey } from "./journey.js";

const ui = Object.fromEntries([...document.querySelectorAll("[id]")].map(element => [element.id, element]));
const modeButtons = [...document.querySelectorAll("[data-length]")];
const gamePanel = document.querySelector(".game-ticket");
const journey = new Journey(ui);
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const memory = new Map();
const wordCache = new Map();
const tickets = new Map();
const welcomed = new Set();
let catalog;
let context = null;
let length = 4;
let loadId = 0;
let editing = null;
let pendingLetter = "";
let ready = false;
let loadingRoutes = null;
let actionPending = false;
let activeHint = null;
let flyingTicket = null;

function message(text, error = false, accepted = false) {
  ui.message.textContent = text;
  ui.message.classList.toggle("error", error);
  ui.message.classList.toggle("success", accepted && !error);
}

function storageWarning(text) {
  ui.storageWarning.hidden = false;
  ui.storageNotice.textContent = text;
}

function current() { return context.state.history.at(-1); }
function finished() { return ready && journeyFinished(context.state, context.puzzle); }
function canRestart() { return ready && context.state.history.length > 1 && !context.state.gaveUp; }

function showWelcome() {
  ui.welcomeDialog.dataset.date = context?.date ?? puzzleDate();
  if (!ui.welcomeDialog.open) ui.welcomeDialog.showModal();
  positionWelcome();
}

function positionWelcome() {
  if (!ui.welcomeDialog.open) return;
  const area = gamePanel.getBoundingClientRect(), dialog = ui.welcomeDialog.getBoundingClientRect();
  const left = area.left + (area.width - dialog.width) / 2;
  const top = Math.min(area.top + area.height / 2, innerHeight / 2) - dialog.height / 2;
  ui.welcomeDialog.style.setProperty("--welcome-left", `${Math.max(14, Math.min(left, innerWidth - dialog.width - 14))}px`);
  ui.welcomeDialog.style.setProperty("--welcome-top", `${Math.max(14, Math.min(top, innerHeight - dialog.height - 14))}px`);
}

function offerWelcome() {
  if (context.daily.ticket || welcomed.has(context.date)) return;
  try {
    if (sessionStorage.getItem(`leximotive:welcome:${context.date}`) === "seen") return;
  } catch (error) {
    storageWarning(`The welcome screen cannot be remembered in this tab. ${error.message}`);
  }
  welcomed.add(context.date);
  showWelcome();
}

function showResults() {
  if (finished() && !ui.resultsDialog.open) {
    ui.resultsDialog.showModal();
    revealSolution();
  }
}

async function revealSolution() {
  if (!ready || !finished() || context.solutionLoading) return;
  const owner = context;
  if (owner.solution) { renderSolution(owner.solution); return; }
  owner.solutionLoading = true;
  ui.retrySolution.hidden = true;
  ui.solutionNote.textContent = "Finding a minimum route...";
  try {
    const path = await owner.routes.request({ type: "solution", word: owner.puzzle.start });
    if (owner !== context) return;
    if (!Array.isArray(path) || path.length !== owner.puzzle.par + 1
        || path[0] !== owner.puzzle.start || path.at(-1) !== owner.puzzle.goal
        || path.some(word => !owner.words.has(word))) throw new Error("Invalid solution response.");
    path.slice(1).forEach((word, index) => changedPosition(path[index], word));
    owner.solution = path;
    renderSolution(path);
  } catch (error) {
    if (owner !== context || error.name === "AbortError") return;
    ui.solutionNote.textContent = `The route could not be revealed: ${error.message}`;
    ui.retrySolution.hidden = false;
  } finally { owner.solutionLoading = false; }
}

function renderSolution(path) {
  ui.solution.replaceChildren(...path.map(word => {
    const item = document.createElement("li");
    item.textContent = word;
    return item;
  }));
  ui.solutionNote.textContent = "";
  ui.retrySolution.hidden = true;
}

function dailyTicket(date) {
  if (!tickets.has(date)) {
    const daily = { key: storageKey(catalog.edition, date), ticket: null, saved: null, canSave: true, needsRecovery: false };
    try {
      daily.saved = localStorage.getItem(daily.key);
      daily.ticket = loadTicket(localStorage, daily.key);
      if (daily.ticket && daily.ticket.puzzleId !== selectPuzzle(catalog, daily.ticket.length, date).id) {
        throw new Error("The saved ticket belongs to a different puzzle.");
      }
    } catch (error) {
      daily.ticket = null;
      daily.canSave = false;
      daily.needsRecovery = !(error instanceof DOMException);
      storageWarning(`${error.message} Playing in memory; use Replace invalid save to repair the ticket.`);
    }
    tickets.set(date, daily);
  }
  return tickets.get(date);
}

function lockTicket() {
  const daily = context.daily;
  if (daily.ticket && daily.ticket.length !== length) throw new Error("Another journey already holds today's ticket.");
  daily.ticket = { version: 3, length, puzzleId: context.puzzle.id, state: structuredClone(context.state) };
  renderTicket();
}

function renderTicket() {
  const chosen = context?.daily.ticket?.length;
  for (const button of modeButtons) button.disabled = actionPending || (chosen !== undefined && +button.dataset.length !== chosen);
  ui.ticketStatus.textContent = chosen
    ? `Ticket booked: ${chosen}-letter journey${context.state.gaveUp ? " \u00b7 ended" : ""}.`
    : "Choose a journey. Your first move or hint books it.";
}

function persist() {
  if (!context) return;
  memory.set(context.key, structuredClone(context.state));
  if (!context.daily.ticket) return;
  context.daily.ticket.state = structuredClone(context.state);
  if (!context.daily.canSave) return;
  try {
    saveTicket(localStorage, context.daily.key, context.daily.ticket);
    context.daily.saved = JSON.stringify(context.daily.ticket);
  } catch (error) {
    context.daily.canSave = false;
    storageWarning(`Progress cannot be saved in this browser. You can still play in this tab. ${error.message}`);
  }
}

async function dailyAction(action) {
  if (actionPending) { message("Please wait for the current ticket action.", true); return; }
  const owner = context;
  actionPending = true;
  updatePreview();
  renderTrack();
  renderTicket();
  ui.board.querySelectorAll("input").forEach(input => { input.disabled = true; });
  ui.startOver.disabled = true;
  ui.giveUp.disabled = true;
  try {
    const perform = async () => {
      if (owner !== context || !ready) throw new Error("The journey changed. Please try again on the current ticket.");
      if (owner.daily.canSave || owner.daily.needsRecovery) {
        const saved = localStorage.getItem(owner.daily.key);
        if (saved !== owner.daily.saved) {
          tickets.delete(owner.date);
          memory.delete(owner.key);
          await loadMode(length, owner.date);
          throw new Error("This ticket changed in another tab. The latest journey is loaded; no action spent.");
        }
      }
      await action();
    };
    if (navigator.locks) await navigator.locks.request(`leximotive:${owner.daily.key}`, perform);
    else if (!owner.daily.canSave && !owner.daily.needsRecovery) await perform();
    else throw new Error("Safe daily saving requires a modern browser over HTTPS or localhost.");
  } catch (error) {
    message(`${error.message} No extra move or hint spent.`, true);
  } finally {
    actionPending = false;
    if (ready) {
      updatePreview();
      renderTrack();
      renderTicket();
      ui.board.querySelectorAll("input").forEach(input => { input.disabled = finished(); });
      ui.startOver.disabled = !canRestart();
      ui.giveUp.disabled = finished();
    }
  }
}

async function getText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url.pathname} (HTTP ${response.status}).`);
  return response.text();
}

async function dictionary(modeLength) {
  if (!wordCache.has(modeLength)) {
    const promise = (async () => {
      const mode = catalog.modes[modeLength];
      const text = await getText(new URL(`../data/${mode.file}`, import.meta.url));
      const words = parseWords(text, modeLength);
      if (words.size !== mode.wordCount) throw new Error("Dictionary count does not match this edition.");
      if (!crypto.subtle) throw new Error("Use HTTPS or localhost so this browser can verify the dictionary.");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      if (checksum !== mode.sha256) throw new Error("Dictionary checksum does not match this edition. Refresh the data.");
      return { text, words };
    })();
    wordCache.set(modeLength, promise);
    promise.catch(() => wordCache.delete(modeLength));
  }
  return wordCache.get(modeLength);
}

function coveredRack() {
  ui.trackLetters.replaceChildren();
  for (let i = 0; i < 2; i++) {
    const ticket = document.createElement("span");
    ticket.className = "track-chip covered";
    ticket.setAttribute("aria-hidden", "true");
    ui.trackLetters.append(ticket);
  }
}

function renderTrack() {
  if (!ready) return;
  const ended = finished();
  const left = 2 - context.state.hints.length;
  ui.trackLetters.replaceChildren();
  ui.trackLetters.classList.add("ticket-pocket");
  context.state.hints.forEach((hint, index) => {
    const pocket = document.createElement("button");
    pocket.type = "button";
    pocket.className = "pocket-ticket";
    pocket.dataset.hintIndex = index;
    pocket.textContent = hint.label;
    pocket.setAttribute("aria-label", `Reopen ticket ${index + 1}: ${hint.label.replaceAll("?", " smudged letter ")}. No hint cost.`);
    pocket.addEventListener("click", () => showHint(index));
    ui.trackLetters.append(pocket);
  });
  ui.hintCount.textContent = `${left} of 2 hints left`;
  ui.requestHint.disabled = ended || left === 0 || actionPending;
  ui.requestHint.textContent = context.hintError ? "Retry hint" : "Request a hint";
  ui.trackNote.textContent = ended ? `${context.state.hints.length} hints used on this journey.`
    : context.hintError ? "Ticket calculation failed. Retry without spending a hint."
    : !left ? "Both hints used. Reopen your pocketed tickets for free."
    : "An oil-smudged ticket points to an unfamiliar, unvisited stop on a shortest route home.";
}

function showHint(index) {
  const hint = context.state.hints[index];
  activeHint = index;
  ui.hintDestination.replaceChildren(...[...hint.label].map(letter => {
    const span = document.createElement("span");
    span.textContent = letter;
    if (letter === "?") span.className = "smudged-letter";
    span.setAttribute("aria-hidden", "true");
    return span;
  }));
  ui.hintDestination.setAttribute("aria-label", `Destination: ${hint.label.replaceAll("?", " smudged letter ")}`);
  ui.hintDirection.textContent = `Found near ${hint.from}. This destination was on a shortest route home from there.${hint.backtrack ? " The shortest route revisits an earlier stop." : ""} Work out the missing letters and your way there.`;
  if (!ui.hintDialog.open) ui.hintDialog.showModal();
}

function pocketHint() {
  if (!ui.hintDialog.open) return;
  const box = ui.foundTicket.getBoundingClientRect();
  const pocket = ui.trackLetters.querySelector(`[data-hint-index="${activeHint}"]`);
  const clone = ui.foundTicket.cloneNode(true);
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
  ui.hintDialog.close();
  pocket?.focus({ preventScroll: true });
  if (motion.matches || !pocket) return;
  flyingTicket?.cancel();
  const target = pocket.getBoundingClientRect();
  clone.classList.add("ticket-flight");
  clone.setAttribute("aria-hidden", "true");
  Object.assign(clone.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  document.body.append(clone);
  const animation = clone.animate([
    { transform: "translate(0, 0) scale(1)", opacity: 1 },
    { transform: `translate(${target.left + target.width / 2 - box.left - box.width / 2}px, ${target.top + target.height / 2 - box.top - box.height / 2}px) scale(${Math.min(target.width / box.width, target.height / box.height)})`, opacity: .3 },
  ], { duration: 300, easing: "ease-in-out" });
  flyingTicket = animation;
  const cleanup = () => {
    clone.remove();
    if (flyingTicket === animation) flyingTicket = null;
  };
  animation.addEventListener("finish", cleanup, { once: true });
  animation.addEventListener("cancel", cleanup, { once: true });
}

async function requestHint() {
  await dailyAction(async () => {
    if (finished()) throw new Error("This journey is already finished.");
    const owner = context;
    try {
      const excluded = owner.state.hints.map(hint => hint.word);
      if (owner.state.coalClaimed) excluded.push(owner.puzzle.coal.word);
      const hint = await owner.routes.request({ type: "hint", word: current(), history: owner.state.seen, excluded });
      if (owner !== context) throw new Error("The journey changed before the ticket arrived.");
      const state = requestTicketHint(owner.state, owner.puzzle, hint);
      lockTicket();
      owner.state = state;
      owner.hintError = false;
      persist();
      renderTrack();
      showHint(state.hints.length - 1);
      message(`A discarded ticket found. ${2 - state.hints.length} hints remain.`);
    } catch (error) {
      owner.hintError = Boolean(owner.routes.failure);
      throw error;
    }
  });
}

function retryHint() {
  if (!ready || ui.requestHint.disabled) return;
  if (context.routes.failure) {
    loadMode(length, context.date);
  } else {
    requestHint();
  }
}

function updatePreview() {
  const candidate = editing === null || !pendingLetter
    ? "" : current().slice(0, editing) + pendingLetter + current().slice(editing + 1);
  const ended = finished();
  ui.preview.hidden = !ready || editing === null || ended;
  ui.preview.textContent = !ready ? "Preparing your current word..."
    : ended ? "This journey is complete."
    : candidate === current() ? `No change: ${candidate}. Type a different letter.`
    : candidate ? `Preview: ${current()} \u2192 ${candidate}. Confirm with Make move.`
    : editing !== null ? `Slot ${editing + 1}: type a letter other than ${current()[editing]}.`
    : "Tap a tile, then type one replacement letter.";
  ui.preview.classList.toggle("pending", Boolean(candidate));
  ui.makeMove.disabled = !ready || actionPending || !candidate || candidate === current() || ended;
  ui.cancelEdit.disabled = editing === null || actionPending;
}

function discardEdit(announce = false) {
  if (editing !== null) {
    const slot = ui.board.children[editing];
    slot.classList.remove("editing", "has-preview");
    slot.querySelector("input").value = current()[editing];
  }
  editing = null;
  pendingLetter = "";
  updatePreview();
  if (announce) message("Change cancelled. No move spent.");
}

function applyInput(input, index) {
  if (editing !== index) return;
  try {
    pendingLetter = input.value === "" ? "" : singleLetter(input.value);
    input.value = pendingLetter;
    input.parentElement.classList.toggle("has-preview", Boolean(pendingLetter));
    message(pendingLetter === current()[index]
      ? "That's the same letter. Type a different one; no move spent."
      : "Preview only; no move spent.");
  } catch (error) {
    input.value = "";
    pendingLetter = "";
    input.parentElement.classList.remove("has-preview");
    message(error.message, true);
  }
  updatePreview();
}

function renderBoard(animate = false) {
  editing = null;
  pendingLetter = "";
  ui.letterHelp.open = false;
  ui.board.replaceChildren();
  ui.board.style.setProperty("--length", length);
  const matches = feedback(current(), context.puzzle.goal);
  [...current()].forEach((letter, index) => {
    const slot = document.createElement("label");
    slot.className = `slot ${matches[index]}`;
    const flipping = animate && !motion.matches
      && index === changedPosition(context.state.history.at(-2), current());
    if (flipping) slot.classList.add("new-turn");
    const ghost = document.createElement("span");
    ghost.className = "ghost";
    ghost.textContent = letter;
    ghost.setAttribute("aria-hidden", "true");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tile-input";
    input.maxLength = 1;
    input.value = letter;
    input.inputMode = "text";
    input.autocomplete = "off";
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "characters");
    input.setAttribute("enterkeyhint", "go");
    input.spellcheck = false;
    const matchLabel = { exact: "right place", elsewhere: "elsewhere in target", absent: "not matched" }[matches[index]];
    input.setAttribute("aria-label", `Position ${index + 1}, ${letter}, ${matchLabel}. Type a replacement letter.`);
    const marking = {
      exact: `Solid underline: ${letter} matches ${context.puzzle.goal} in position ${index + 1}. It is not locked.`,
      elsewhere: `Dotted underline: ${letter} matches ${context.puzzle.goal} in a different position.`,
      absent: `${letter} has no remaining match in ${context.puzzle.goal}.`,
    }[matches[index]];
    input.title = marking;
    input.setAttribute("aria-describedby", "tileKey preview boardNote message");
    input.disabled = finished() || actionPending;
    input.addEventListener("focus", () => {
      slot.classList.remove("new-turn");
      slot.querySelector(".flip-before")?.remove();
      if (editing === index) return;
      discardEdit();
      editing = index;
      input.value = "";
      slot.classList.add("editing");
      updatePreview();
      message(`Replace ${letter} in slot ${index + 1}. ${marking}`);
    });
    input.addEventListener("beforeinput", event => {
      if (!event.isComposing && event.inputType.startsWith("insert") && event.data !== null
          && !/^[a-zA-Z]$/.test(event.data)) {
        event.preventDefault();
        message("Enter one letter, A-Z. Multi-letter input is not accepted.", true);
      } else if (!event.isComposing && event.inputType === "insertText"
          && /^[a-zA-Z]$/.test(event.data) && input.value.length === 1) {
        event.preventDefault();
        input.value = event.data;
        applyInput(input, index);
      }
    });
    input.addEventListener("paste", event => {
      event.preventDefault();
      try {
        input.value = singleLetter(event.clipboardData.getData("text/plain"));
        applyInput(input, index);
      } catch (error) {
        message(error.message, true);
      }
    });
    input.addEventListener("input", event => { if (!event.isComposing) applyInput(input, index); });
    input.addEventListener("compositionend", () => applyInput(input, index));
    input.addEventListener("animationend", event => {
      if (event.animationName === "flap-arrive") slot.classList.remove("new-turn");
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        discardEdit(true);
        input.blur();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const next = (index + (event.key === "ArrowLeft" ? -1 : 1) + length) % length;
        ui.board.children[next].querySelector("input").focus();
      }
    });
    const hinges = document.createElement("span");
    hinges.className = "tile-hinges";
    hinges.setAttribute("aria-hidden", "true");
    slot.append(ghost, input, hinges);
    if (flipping) {
      const previous = document.createElement("span");
      previous.className = "flip-before";
      previous.textContent = context.state.history.at(-2)[index];
      previous.setAttribute("aria-hidden", "true");
      previous.addEventListener("animationend", () => previous.remove(), { once: true });
      slot.append(previous);
    }
    ui.board.append(slot);
  });
  updatePreview();
}

function render(animate = false) {
  ui.dayNotice.hidden = puzzleDate() === context.date;
  ui.startWord.textContent = context.puzzle.start;
  ui.goalWord.textContent = context.puzzle.goal;
  const { moves, transforms, free } = journeyMoves(context.puzzle, context.state.history, context.state.coalTurn);
  ui.moveCount.textContent = moves;
  ui.parCount.textContent = context.puzzle.par;
  ui.restartCount.textContent = context.state.restarts;
  ui.moveDetail.textContent = free ? `${transforms} transforms, 1 free stop` : "Accepted transforms";
  ui.coalCredit.hidden = !free;
  ui.moveCount.parentElement.title = `${transforms} accepted transforms${free ? ", minus one free Coaling Station landing" : ""}.`;
  ui.dateLabel.textContent = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", month: "long", day: "numeric", year: "numeric",
  }).format(new Date(`${context.date}T12:00:00Z`));
  ui.lineLabel.textContent = `FIRST TIMETABLE / ${length} LETTERS / LINE ${context.puzzle.id.split("-")[1]}`;
  const won = current() === context.puzzle.goal;
  const ended = finished();
  ui.boardInstruction.textContent = context.state.gaveUp ? `Journey ended. Home: ${context.puzzle.goal}.`
    : won ? `Home: ${context.puzzle.goal}.` : `Reach ${context.puzzle.goal}. Change one letter.`;
  ui.boardInstruction.classList.toggle("visually-hidden", ended);
  ui.boardNote.textContent = `Marks compare the accepted word with ${context.puzzle.goal}, not route distance. Underlined letters can still change.`;
  ui.winPanel.hidden = !ended;
  ui.startOver.disabled = !canRestart();
  ui.startOver.title = context.state.gaveUp ? "Today's journey has ended."
    : canRestart() ? "Restart this journey. Your choice and hints used stay booked." : "Make a move before starting over.";
  ui.giveUp.disabled = ended;
  ui.giveUp.hidden = ended;
  ui.recoverSave.hidden = !context.daily.needsRecovery;
  ui.recoverSave.disabled = false;
  ui.board.closest(".board-section").classList.toggle("is-finished", ended);
  if (ended) {
    ui.winTitle.textContent = won ? "You Made it Home!" : "End of the line.";
    ui.resultStatus.textContent = won ? "DESTINATION REACHED" : "JOURNEY ENDED";
    ui.winSummary.textContent = `${moves} counted moves${won ? ` against par ${context.puzzle.par}` : ` played; home wasn't reached. Par is ${context.puzzle.par}`}. ${transforms} transforms${free ? ", including your free Coaling Station stop" : ""}. ${context.state.hints.length} hints used. ${context.state.restarts} restarts.${context.state.gaveUp ? " No more attempts today." : ""}`;
    ui.solutionTitle.textContent = `An optimal route \u00b7 ${context.puzzle.par} transforms`;
    ui.solution.replaceChildren();
    if (context.solution) renderSolution(context.solution);
  }
  renderBoard(animate);
  journey.render(context.state.history, context.puzzle.goal, animate, context.puzzle.coal, context.state.coalTurn, context.state.coalClaimed);
  if (context.state.gaveUp) {
    ui.currentStopLabel.textContent = `${String(transforms).padStart(2, "0")} / JOURNEY ENDED`;
    ui.coalStation.hidden = true;
  }
  ui.coalClue.textContent = context.puzzle.coal.clue;
  ui.coalStatus.textContent = free ? `Visited ${context.puzzle.coal.word}. One landing move is free.`
    : context.state.coalClaimed ? "Today's free stop was claimed on an earlier run."
    : "Optional stop: solve the clue and land on its word for one free transform.";
  renderTicket();
  renderTrack();
}

async function loadMode(modeLength, date = puzzleDate()) {
  const token = ++loadId;
  if (loadingRoutes) {
    loadingRoutes.dispose();
    loadingRoutes = null;
  }
  if (context) {
    context.routes.dispose();
  }
  ready = false;
  ui.board.dataset.ready = "false";
  for (const dialog of [ui.resultsDialog, ui.restartDialog, ui.giveUpDialog, ui.recoveryDialog, ui.hintDialog]) {
    if (dialog.open) dialog.close();
  }
  context = null;
  flyingTicket?.cancel();
  editing = null;
  pendingLetter = "";
  const daily = dailyTicket(date);
  length = daily.ticket?.length ?? modeLength;
  for (const button of modeButtons) button.setAttribute("aria-pressed", String(+button.dataset.length === length));
  ui.board.replaceChildren();
  journey.clear();
  ui.boardInstruction.textContent = "Preparing your current word...";
  ui.winPanel.hidden = true;
  ui.makeMove.disabled = true;
  ui.cancelEdit.disabled = true;
  ui.startOver.disabled = true;
  ui.giveUp.disabled = true;
  ui.recoverSave.disabled = true;
  ui.requestHint.disabled = true;
  ui.retry.hidden = true;
  ui.dayNotice.hidden = true;
  coveredRack();
  message("Preparing the departures and checking the routes...");
  let routes;
  try {
    const { text, words } = await dictionary(length);
    if (token !== loadId) return;
    const puzzle = selectPuzzle(catalog, length, date);
    if ([puzzle.start, puzzle.goal, puzzle.coal.word].some(word => !words.has(word))) throw new Error("The timetable and dictionary do not match.");
    routes = new RouteClient();
    loadingRoutes = routes;
    const result = await routes.request({ type: "load", text, ranks: catalog.modes[length].ranks, length, goal: puzzle.goal, coal: puzzle.coal.word, start: puzzle.start });
    if (token !== loadId) { routes.dispose(); return; }
    if (result.par !== puzzle.par) throw new Error("Published par does not match the actual dictionary. Please refresh the data.");
    const key = `${date}:${length}`;
    let state = freshState(puzzle);
    try {
      if (daily.ticket) state = validateState(structuredClone(daily.ticket.state), puzzle, words);
      else if (memory.has(key)) state = validateState(structuredClone(memory.get(key)), puzzle, words);
    } catch (error) {
      daily.canSave = false;
      daily.needsRecovery = true;
      storageWarning(`Saved progress could not be loaded: ${error.message} Playing in memory; use Replace invalid save to repair the ticket.`);
    }
    context = {
      puzzle, date, words, routes, key, state, daily, hintError: false, solution: null, solutionLoading: false,
    };
    loadingRoutes = null;
    ready = true;
    ui.board.dataset.ready = "true";
    render();
    message(state.gaveUp ? "Today's journey ended. View results for the optimal route."
      : current() === puzzle.goal ? "You Made it Home!"
      : state.history.length > 1 ? `Continue from ${current()} toward ${puzzle.goal}. Tap a large tile to change one letter.`
      : "Tap a tile to replace one letter.");
    try { localStorage.setItem("textumble:preferred-length", String(length)); }
    catch (error) {
      daily.canSave = false;
      storageWarning(`Browser storage is unavailable. Progress and preferences remain in this tab only. ${error.message}`);
    }
    if (finished()) showResults();
    else offerWelcome();
  } catch (error) {
    if (routes) routes.dispose();
    if (loadingRoutes === routes) loadingRoutes = null;
    if (token !== loadId) return;
    message(`The game could not load: ${error.message}`, true);
    ui.retry.hidden = false;
  }
}

ui.moveForm.addEventListener("submit", event => {
  event.preventDefault();
  if (finished()) { message("This journey is finished. View results for the optimal route.", true); return; }
  if (!ready || editing === null || !pendingLetter) { message("Select a tile and enter one letter.", true); return; }
  const before = current();
  const candidate = before.slice(0, editing) + pendingLetter + before.slice(editing + 1);
  dailyAction(() => {
    const state = advanceJourney(context.state, candidate, context.puzzle, context.words);
    const coal = state.coalTurn !== context.state.coalTurn;
    lockTicket();
    context.state = state;
    context.hintError = false;
    render(true);
    persist();
    message(current() === context.puzzle.goal ? "You Made it Home!"
      : coal ? "Coaling Station reached! One free move."
      : `Accepted: ${before} \u2192 ${candidate}.`, false, true);
    if (finished()) showResults();
  });
});
ui.cancelEdit.addEventListener("click", () => {
  const input = ui.board.querySelector("input:focus");
  discardEdit(true);
  input?.blur();
});
for (const button of modeButtons) button.addEventListener("click", () => {
  if (catalog && !button.disabled) loadMode(+button.dataset.length, context?.date ?? puzzleDate());
});

ui.requestHint.addEventListener("click", retryHint);
ui.closeHint.addEventListener("click", pocketHint);
ui.pocketHint.addEventListener("click", pocketHint);
ui.hintDialog.addEventListener("cancel", event => { event.preventDefault(); pocketHint(); });
ui.retrySolution.addEventListener("click", () => context.routes.failure ? loadMode(length, context.date) : revealSolution());

for (const button of document.querySelectorAll("[data-dialog]")) button.addEventListener("click", () => {
  ui[button.dataset.dialog].showModal();
});
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => dialog.close()));
}
document.addEventListener("pointerdown", event => {
  for (const help of [ui.letterHelp, ui.hintHelp]) {
    if (help.open && event.target instanceof Node && !help.contains(event.target)) help.open = false;
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    ui.letterHelp.open = false;
    ui.hintHelp.open = false;
  }
});
ui.startOver.addEventListener("click", () => {
  if (!canRestart()) return;
  ui.restartDialog.showModal();
});
ui.confirmRestart.addEventListener("click", () => {
  if (!canRestart()) { ui.restartDialog.close(); return; }
  dailyAction(() => {
  if (!Number.isSafeInteger(context.state.restarts + 1)) {
    message("The restart counter cannot be increased further.", true);
    ui.restartDialog.close();
    return;
  }
  context.state = freshState(context.puzzle, context.state.restarts + 1, context.state.hints, context.state.coalClaimed, context.state.seen);
  context.solution = null;
  context.daily.canSave = true;
  context.daily.needsRecovery = false;
  if (context.daily.ticket) lockTicket();
  else {
    try { localStorage.removeItem(context.daily.key); }
    catch (error) {
      context.daily.canSave = false;
      storageWarning(`The saved ticket could not be cleared: ${error.message}`);
    }
  }
  context.hintError = false;
  ui.restartDialog.close();
  render();
  ui.storageWarning.hidden = context.daily.canSave;
  persist();
  message(context.daily.ticket ? "A fresh start. Same daily ticket; hints used stay used."
    : "A fresh preview. Your daily choice is still open.");
  });
});
ui.giveUp.addEventListener("click", () => {
  if (ready && !finished()) ui.giveUpDialog.showModal();
});
ui.confirmGiveUp.addEventListener("click", () => {
  if (!ready || finished()) { ui.giveUpDialog.close(); return; }
  dailyAction(() => {
    const state = abandonJourney(context.state, context.puzzle);
    lockTicket();
    context.state = state;
    ui.giveUpDialog.close();
    render();
    persist();
    message("Journey ended. View the optimal route in your results.");
    showResults();
  });
});
ui.openWelcome.addEventListener("click", showWelcome);
ui.welcomeDialog.addEventListener("close", () => {
  const date = ui.welcomeDialog.dataset.date;
  if (!date) return;
  welcomed.add(date);
  try { sessionStorage.setItem(`leximotive:welcome:${date}`, "seen"); }
  catch (error) { storageWarning(`The welcome screen cannot be remembered in this tab. ${error.message}`); }
});
ui.viewResults.addEventListener("click", showResults);
ui.recoverSave.addEventListener("click", () => {
  if (ready && context.daily.needsRecovery) ui.recoveryDialog.showModal();
});
ui.confirmRecovery.addEventListener("click", () => {
  if (!ready || !context.daily.needsRecovery) { ui.recoveryDialog.close(); return; }
  dailyAction(() => {
    if (context.daily.ticket) {
      context.daily.ticket.state = structuredClone(context.state);
      saveTicket(localStorage, context.daily.key, context.daily.ticket);
    } else localStorage.removeItem(context.daily.key);
    context.daily.saved = localStorage.getItem(context.daily.key);
    context.daily.canSave = true;
    context.daily.needsRecovery = false;
    ui.storageWarning.hidden = true;
    ui.recoveryDialog.close();
    render();
    message("The invalid save was replaced. No move or restart spent.");
  });
});
ui.newDay.addEventListener("click", () => loadMode(length));
ui.retry.addEventListener("click", () => catalog ? loadMode(length) : boot());
motion.addEventListener("change", () => {
  if (!motion.matches) return;
  flyingTicket?.cancel();
  for (const slot of ui.board.querySelectorAll(".new-turn")) {
    slot.classList.remove("new-turn");
    slot.querySelector(".flip-before")?.remove();
  }
});
window.addEventListener("storage", event => {
  if (!context || event.key !== context.daily.key) return;
  const date = context.date;
  tickets.delete(date);
  memory.delete(context.key);
  loadMode(length, date);
});
setInterval(() => {
  if (!ready) return;
  ui.dayNotice.hidden = puzzleDate() === context.date;
}, 5000);
window.addEventListener("resize", positionWelcome);
window.addEventListener("scroll", positionWelcome, { passive: true });
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    if (editing !== null) ui.moveForm.parentElement.scrollIntoView({ block: "nearest" });
    positionWelcome();
  });
}

async function boot() {
  try {
    catalog = validateCatalog(JSON.parse(await getText(new URL("../data/puzzles.json", import.meta.url))));
    try {
      const preferred = localStorage.getItem("textumble:preferred-length");
      if (preferred !== null && !/^[456]$/.test(preferred)) throw new Error("Invalid saved word-length preference.");
      length = preferred === null ? 4 : +preferred;
    } catch (error) { storageWarning(`Using four letters: ${error.message}`); }
    await loadMode(length);
  } catch (error) {
    message(`Today's route could not load: ${error.message}`, true);
    ui.retry.hidden = false;
  }
}
boot();
