const DAY = 86_400_000;
const pacific = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", hourCycle: "h23",
});

export function puzzleDate(now = new Date()) {
  const parts = Object.fromEntries(pacific.formatToParts(now).map(part => [part.type, part.value]));
  const date = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
  if (+parts.hour < 8) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function selectPuzzle(catalog, length, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error("Invalid puzzle date.");
  }
  const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${catalog.epoch}T00:00:00Z`)) / DAY;
  if (!Number.isInteger(days)) throw new Error("Invalid puzzle date.");
  const index = ((days % catalog.cycleDays) + catalog.cycleDays) % catalog.cycleDays;
  return catalog.modes[String(length)].puzzles[index];
}

export function parseWords(text, length) {
  const lines = text.trim().split(/\r?\n/);
  const pattern = new RegExp(`^[A-Z]{${length}}$`);
  if (!lines.length || lines.some(word => !pattern.test(word))) throw new Error("Invalid word-list format.");
  const words = new Set(lines);
  if (words.size !== lines.length) throw new Error("Duplicate words in dictionary.");
  return words;
}

export function singleLetter(value) {
  if (!/^[a-zA-Z]$/.test(value)) throw new Error("Enter one letter, A-Z.");
  return value.toUpperCase();
}

export function changedPosition(before, after) {
  if (before.length !== after.length) throw new Error("Words must keep the same length.");
  const changed = [...before].map((letter, i) => letter !== after[i] ? i : -1).filter(i => i >= 0);
  if (changed.length !== 1) throw new Error("Change exactly one letter.");
  return changed[0];
}

export function makeMove(history, candidate, puzzle, words) {
  if (history.at(-1) === puzzle.goal) throw new Error("This puzzle is already finished.");
  changedPosition(history.at(-1), candidate);
  if (!words.has(candidate)) throw new Error(`${candidate} is not in Leximotive's word list. Try another letter.`);
  return [...history, candidate];
}

export function feedback(word, goal) {
  const result = Array(word.length).fill("absent");
  const remaining = {};
  [...goal].forEach((letter, i) => {
    if (word[i] === letter) result[i] = "exact";
    else remaining[letter] = (remaining[letter] || 0) + 1;
  });
  [...word].forEach((letter, i) => {
    if (result[i] !== "exact" && remaining[letter] > 0) {
      result[i] = "elsewhere";
      remaining[letter]--;
    }
  });
  return result;
}

export function journeyMoves(puzzle, history, coalTurn = null) {
  const transforms = history.length - 1;
  const free = coalTurn !== null && history[coalTurn] === puzzle.coal.word ? 1 : 0;
  return { transforms, free, moves: transforms - free };
}

export function advanceJourney(state, candidate, puzzle, words) {
  if (journeyFinished(state, puzzle)) throw new Error("This journey is already finished.");
  const history = makeMove(state.history, candidate, puzzle, words);
  const earned = !state.coalClaimed && candidate === puzzle.coal.word;
  return { ...state, history, seen: [...new Set([...state.seen, candidate])], coalClaimed: state.coalClaimed || earned,
    coalTurn: earned ? history.length - 1 : state.coalTurn };
}

export function journeyFinished(state, puzzle) {
  return state.gaveUp === true || state.history.at(-1) === puzzle.goal;
}

export function abandonJourney(state, puzzle) {
  if (journeyFinished(state, puzzle)) throw new Error("This journey is already finished.");
  return { ...state, gaveUp: true };
}

export function validateHint(hint, puzzle, words) {
  const pattern = new RegExp(`^[A-Z]{${puzzle.start.length}}$`);
  if (!hint || !pattern.test(hint.from) || !pattern.test(hint.word)
      || hint.target !== puzzle.goal || hint.word === hint.from || hint.word === puzzle.goal
      || (words && (!words.has(hint.from) || !words.has(hint.word)))
      || typeof hint.backtrack !== "boolean"
      || typeof hint.label !== "string" || hint.label.length !== hint.word.length
      || (hint.label.match(/\?/g)?.length ?? 0) !== (hint.word.length === 6 ? 2 : 1)
      || [...hint.label].some((letter, index) => letter !== "?" && letter !== hint.word[index])) {
    throw new Error("Invalid waypoint ticket.");
  }
  return hint;
}

export function requestTicketHint(state, puzzle, hint) {
  if (journeyFinished(state, puzzle)) throw new Error("This journey is already finished.");
  if (state.hints.length >= 2) throw new Error("Both hints have been used. Restarting does not refill them.");
  if (!hint) throw new Error("No unread waypoint on your shortest route. Make a move before another request; no hint spent.");
  validateHint(hint, puzzle);
  if (hint.from !== state.history.at(-1) || state.seen.includes(hint.word)
      || state.hints.some(previous => previous.word === hint.word)
      || (state.coalClaimed && hint.word === puzzle.coal.word)) {
    throw new Error("This ticket would repeat a known stop; no hint spent.");
  }
  return { ...state, hints: [...state.hints, structuredClone(hint)] };
}

export function validateCatalog(catalog) {
  if (catalog?.version !== 3 || typeof catalog.edition !== "string" || !/^[a-z0-9-]+$/.test(catalog.edition)
      || !/^\d{4}-\d{2}-\d{2}$/.test(catalog.epoch) || !Number.isFinite(Date.parse(catalog.epoch))
      || !Number.isInteger(catalog.cycleDays) || catalog.cycleDays < 1 || catalog.timeZone !== "America/Los_Angeles"
      || catalog.rolloverHour !== 8 || catalog.hintsPerJourney !== 2
      || catalog.wordPolicy !== "scowl-american-60-v2") {
    throw new Error("Unsupported puzzle catalog.");
  }
  if (new Date(`${catalog.epoch}T00:00:00Z`).toISOString().slice(0, 10) !== catalog.epoch) {
    throw new Error("Invalid timetable epoch.");
  }
  for (const length of [4, 5, 6]) {
    const mode = catalog.modes?.[length];
    if (typeof mode?.timetable !== "string") throw new Error("Missing encoded timetable.");
    const payload = JSON.parse(atob(mode.timetable));
    mode.puzzles = payload.puzzles;
    mode.ranks = payload.ranks;
    const pattern = new RegExp(`^[A-Z]{${length}}$`);
    if (mode?.file !== `words${length}.txt` || !Number.isInteger(mode.wordCount)
        || mode.wordCount < 1 || !/^[a-f0-9]{64}$/.test(mode.sha256)
        || !Array.isArray(mode.puzzles) || mode.puzzles.length !== catalog.cycleDays
        || !Array.isArray(mode.ranks) || mode.ranks.length !== mode.wordCount
        || mode.ranks.some(rank => !Number.isSafeInteger(rank) || rank < 1 || rank > 50_001)) {
      throw new Error(`Invalid ${length}-letter puzzle bank.`);
    }
    const ids = new Set();
    for (const puzzle of mode.puzzles) {
      if (typeof puzzle.id !== "string" || ids.has(puzzle.id)
          || !pattern.test(puzzle.start) || !pattern.test(puzzle.goal)
          || !Number.isInteger(puzzle.par) || puzzle.par < 1
          || "solution" in puzzle
          || [...puzzle.start].filter((letter, i) => letter === puzzle.goal[i]).length > (length === 6 ? 1 : 0)
          || !pattern.test(puzzle.coal?.word) || typeof puzzle.coal?.clue !== "string"
          || !puzzle.coal.clue.trim() || puzzle.coal.clue.length > 240
          || [puzzle.start, puzzle.goal].includes(puzzle.coal.word)) {
        throw new Error("Invalid puzzle.");
      }
      ids.add(puzzle.id);
    }
  }
  return catalog;
}
