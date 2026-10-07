import { changedPosition, validateHint } from "./engine.js";

export function storageKey(edition, date) {
  return `leximotive:${edition}:${date}:ticket`;
}

export function freshState(puzzle, restarts = 0, hints = [], coalClaimed = false, seen = [puzzle.start]) {
  return { version: 3, history: [puzzle.start], restarts, hints: structuredClone(hints),
    gaveUp: false, coalClaimed, coalTurn: null, seen: [...seen] };
}

export function validateState(state, puzzle, words) {
  if (state?.version !== 3 || !Array.isArray(state.history) || !state.history.length
      || state.history[0] !== puzzle.start
      || state.history.some(word => typeof word !== "string" || !words.has(word))
      || !Array.isArray(state.seen) || state.seen.length > words.size
      || new Set(state.seen).size !== state.seen.length
      || state.seen.some(word => !words.has(word)) || state.history.some(word => !state.seen.includes(word))
      || !Number.isSafeInteger(state.restarts) || state.restarts < 0
      || !Array.isArray(state.hints) || state.hints.length > 2
      || (state.gaveUp !== undefined && typeof state.gaveUp !== "boolean")
      || (state.gaveUp === true && state.history.at(-1) === puzzle.goal)
      || typeof state.coalClaimed !== "boolean"
      || (state.coalTurn !== null && (!Number.isSafeInteger(state.coalTurn)
        || state.coalTurn < 1 || state.history[state.coalTurn] !== puzzle.coal.word
        || state.history.indexOf(puzzle.coal.word) !== state.coalTurn || !state.coalClaimed))
      || state.coalClaimed !== state.seen.includes(puzzle.coal.word)) {
    throw new Error("Saved progress is invalid. Start over to replace it.");
  }
  state.history.slice(1).forEach((word, i) => {
    if (state.history[i] === puzzle.goal) throw new Error("Saved progress continues after finishing.");
    changedPosition(state.history[i], word);
  });
  const seen = new Set();
  for (const hint of state.hints) {
    validateHint(hint, puzzle, words);
    if (!state.seen.includes(hint.from)) throw new Error("Saved ticket was issued at an unvisited stop.");
    const key = hint.word;
    if (seen.has(key)) throw new Error("Saved hints contain a duplicate.");
    seen.add(key);
  }
  return { ...state, gaveUp: state.gaveUp ?? false };
}

export function loadTicket(storage, key) {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const ticket = JSON.parse(raw);
  if (ticket?.version !== 3 || ![4, 5, 6].includes(ticket.length)
      || typeof ticket.puzzleId !== "string" || !ticket.state) {
    throw new Error("Saved daily ticket is invalid. Start over explicitly to replace it.");
  }
  return ticket;
}

export function saveTicket(storage, key, ticket) {
  storage.setItem(key, JSON.stringify(ticket));
}
