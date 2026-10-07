import {
  changedPosition, feedback, makeMove, parseWords, puzzleDate, selectPuzzle,
  abandonJourney, advanceJourney, journeyFinished, journeyMoves, requestTicketHint, singleLetter, validateCatalog,
} from "../js/engine.js";
import { WordGraph } from "../js/graph.js";
import { freshState, loadTicket, saveTicket, storageKey, validateState } from "../js/storage.js";
import { RouteClient } from "../js/route-client.js";

const results = [];
function assert(value, message = "Assertion failed") { if (!value) throw new Error(message); }
function equal(a, b) {
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  assert(canonical(a) === canonical(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}
function throws(fn) { let caught = false; try { fn(); } catch { caught = true; } assert(caught, "Expected rejection"); }
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); }
}
class MemoryStorage {
  constructor() { this.items = new Map(); }
  getItem(key) { return this.items.get(key) ?? null; }
  setItem(key, value) { this.items.set(key, value); }
}
function oracle(words, goal) {
  const distance = new Map([[goal, 0]]), counts = new Map([[goal, 1n]]), queue = [goal];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const word = queue[cursor];
    for (const next of words) {
      if ([...word].filter((letter, i) => letter !== next[i]).length !== 1) continue;
      if (!distance.has(next)) { distance.set(next, distance.get(word) + 1); counts.set(next, 0n); queue.push(next); }
      if (distance.get(next) === distance.get(word) + 1) counts.set(next, counts.get(next) + counts.get(word));
    }
  }
  return { distance, counts };
}

await test("Single ASCII letters; lowercase normalization; reject multi-letter and non-letter input", () => {
  equal(singleLetter("a"), "A");
  for (const value of ["", "ab", "A ", "1", "-", "\u00e9", "\ud83d\ude00", "\uff21", "\u017f"]) throws(() => singleLetter(value));
});
await test("Exactly one position changes, with unrestricted alphabet jumps", () => {
  equal(changedPosition("AAAA", "ZAAA"), 0);
  for (const pair of [["AAAA", "AAAA"], ["AAAA", "ZZAA"], ["AAAA", "AAA"]]) throws(() => changedPosition(...pair));
});
await test("Moves don't mutate prior history; invalid guesses are free; revisits are allowed", () => {
  const puzzle = { start: "BOOK", goal: "POOP" };
  const words = new Set(["BOOK", "BOOT", "LOOT", "LOOP", "POOP"]);
  const history = ["BOOK"];
  equal(makeMove(history, "BOOT", puzzle, words), ["BOOK", "BOOT"]);
  equal(history, ["BOOK"]);
  throws(() => makeMove(history, "BOON", puzzle, words));
  equal(history, ["BOOK"]);
  equal(makeMove(["BOOK", "BOOT"], "BOOK", puzzle, words), ["BOOK", "BOOT", "BOOK"]);
  throws(() => makeMove(["POOP"], "LOOP", puzzle, words));
});
await test("Giving up a matching letter remains a valid move", () => {
  equal(makeMove(["POON"], "BOON", { goal: "POOP" }, new Set(["POON", "BOON", "POOP"])), ["POON", "BOON"]);
});
await test("Repeated target letters are consumed correctly by color feedback", () => {
  equal(feedback("OOOO", "POOP"), ["absent", "exact", "exact", "absent"]);
  equal(feedback("OPPO", "POOP"), ["elsewhere", "elsewhere", "elsewhere", "elsewhere"]);
  equal(feedback("POOP", "POOP"), ["exact", "exact", "exact", "exact"]);
  equal(feedback("RILE", "MINT"), ["absent", "exact", "absent", "absent"]);
  equal(makeMove(["RICE"], "RILE", { goal: "MINT" }, new Set(["RICE", "RILE", "MINT"])), ["RICE", "RILE"]);
});
await test("Pacific 8 AM cutoff follows both standard and daylight-saving time", () => {
  for (const [instant, expected] of [
    ["2026-10-06T14:59:59Z", "2026-10-05"], ["2026-10-06T15:00:00Z", "2026-10-06"],
    ["2026-01-06T15:59:59Z", "2026-01-05"], ["2026-01-06T16:00:00Z", "2026-01-06"],
    ["2026-03-08T14:59:59Z", "2026-03-07"], ["2026-03-08T15:00:00Z", "2026-03-08"],
    ["2026-11-01T15:59:59Z", "2026-10-31"], ["2026-11-01T16:00:00Z", "2026-11-01"],
  ]) equal(puzzleDate(new Date(instant)), expected);
});
await test("Two waypoint tickets; no repeated known stops; restart preserves hints", () => {
  const puzzle = { start: "BOOK", goal: "POOP", coal: { word: "LOOT" } };
  let state = freshState(puzzle);
  const first = { from: "BOOK", word: "LOOT", target: "POOP", label: "LO?T", backtrack: false };
  state = requestTicketHint(state, puzzle, first);
  equal(state.hints, [first]);
  throws(() => requestTicketHint(state, puzzle, first));
  equal(state.hints.length, 1);
  state = { ...state, history: ["BOOK", "BOOT"], seen: ["BOOK", "BOOT"] };
  state = requestTicketHint(state, puzzle, { from: "BOOT", word: "LOOP", target: "POOP", label: "L?OP", backtrack: false });
  equal(state.hints.length, 2);
  const restarted = freshState(puzzle, 1, state.hints);
  equal(restarted.hints, state.hints);
  throws(() => requestTicketHint(restarted, puzzle, first));
});
await test("A station credit is once per day; claimed and unclaimed state survives resets", () => {
  const puzzle = { start: "BOOK", goal: "POOP", coal: { word: "LOOT" } };
  equal(journeyMoves(puzzle, ["BOOK"]), { transforms: 0, free: 0, moves: 0 });
  equal(journeyMoves(puzzle, ["BOOK", "BOOT", "LOOT"], 2), { transforms: 2, free: 1, moves: 1 });
  equal(journeyMoves(puzzle, ["BOOK", "BOOT", "LOOT", "BOOT", "LOOT"], 2), { transforms: 4, free: 1, moves: 3 });
  equal(journeyMoves(puzzle, ["BOOK", "LOOK", "LOOP", "POOP"]), { transforms: 3, free: 0, moves: 3 });
  const words = new Set(["BOOK", "BOOT", "LOOT", "LOOP", "POOP"]);
  let state = freshState(puzzle);
  for (const word of ["BOOT", "LOOT"]) state = advanceJourney(state, word, puzzle, words);
  assert(state.coalClaimed && state.coalTurn === 2);
  state = freshState(puzzle, 1, state.hints, state.coalClaimed, state.seen);
  for (const word of ["BOOT", "LOOT"]) state = advanceJourney(state, word, puzzle, words);
  equal(journeyMoves(puzzle, state.history, state.coalTurn), { transforms: 2, free: 0, moves: 2 });
  state = advanceJourney(freshState(puzzle, 1), "BOOT", puzzle, words);
  state = advanceJourney(state, "LOOT", puzzle, words);
  assert(state.coalClaimed && state.coalTurn === 2);
});
await test("Giving up ends a journey without spending a move, including an untouched preview", () => {
  const puzzle = { start: "BOOK", goal: "POOP", coal: { word: "LOOT" } };
  const original = freshState(puzzle);
  const ended = abandonJourney(original, puzzle);
  assert(ended.gaveUp && journeyFinished(ended, puzzle));
  assert(!original.gaveUp && !journeyFinished(original, puzzle));
  equal(ended.history, ["BOOK"]);
  throws(() => requestTicketHint(ended, puzzle, null));
  throws(() => abandonJourney(ended, puzzle));
  throws(() => abandonJourney({ ...original, history: ["BOOK", "BOOT", "LOOT", "LOOP", "POOP"] }, puzzle));
});
await test("Dictionary parsing fails on malformed entries and duplicates", () => {
  equal([...parseWords("BOOK\nBOOT\n", 4)], ["BOOK", "BOOT"]);
  for (const text of ["", "book\n", "BOOK\nBOOK", "BOOK\nBO1T", "BOOK\nSTONE"]) throws(() => parseWords(text, 4));
});
await test("Shortest distances and exact route counts match an independent pairwise oracle", () => {
  const words = new Set(["COLD", "CORD", "CARD", "WARD", "WARM", "CALD", "WOLD", "WALD", "WORD", "CORM", "WORM", "ZZZZ"]);
  const graph = new WordGraph(words);
  graph.target("WARM");
  const reference = oracle(words, "WARM");
  for (const word of words) {
    assert(graph.distance.get(word) === reference.distance.get(word));
    assert(graph.counts.get(word) === reference.counts.get(word));
  }
  equal(graph.trackLetters("COLD"), ["R", "W"]);
  equal(graph.trackLetters("WARM"), []);
  throws(() => graph.trackLetters("ZZZZ"));
});
await test("Only one genuine next letter is shown, even with many optimal slots", () => {
  const words = new Set();
  for (let mask = 0; mask < 16; mask++) words.add([...Array(4)].map((_, i) => mask & (1 << i) ? "B" : "A").join(""));
  const graph = new WordGraph(words);
  graph.target("AAAA");
  assert(graph.counts.get("BBBB") === 24n);
  equal(graph.trackLetters("BBBB"), ["A"]);
});
await test("Two-target cache reuses routes and evicts the least recently used target", () => {
  const graph = new WordGraph(new Set(["BOOK", "BOOT", "LOOT", "LOOP", "POOP"]));
  graph.target("POOP");
  const home = graph.distance;
  graph.target("LOOT");
  graph.target("POOP");
  assert(graph.distance === home);
  graph.target("BOOT");
  assert(graph.routes.size === 2 && !graph.routes.has("LOOT"));
  graph.target("POOP");
  assert(graph.distance === home && graph.distance.get("BOOK") === 4);
  assert(graph.counts.get("BOOK") === 1n);
});
await test("Persistence restores history/restarts; malformed records are not overwritten", () => {
  const words = new Set(["BOOK", "BOOT", "LOOT", "LOOP", "POOP"]);
  const puzzle = { id: "4-01", start: "BOOK", goal: "POOP", coal: { word: "LOOT" } };
  const store = new MemoryStorage();
  const key = storageKey("v2", "2026-10-06");
  equal(key, "leximotive:v2:2026-10-06:ticket");
  const state = { ...freshState(puzzle, 2), history: ["BOOK", "BOOT"], seen: ["BOOK", "BOOT"] };
  const ticket = { version: 3, length: 4, puzzleId: puzzle.id, state };
  saveTicket(store, key, ticket);
  equal(loadTicket(store, key), ticket);
  equal(validateState(loadTicket(store, key).state, puzzle, words), state);
  assert(storageKey("v2", "2026-10-07") !== key);
  assert(storageKey("v3", "2026-10-06") !== key);
  store.setItem(key, "bad JSON");
  throws(() => loadTicket(store, key));
  equal(store.getItem(key), "bad JSON");
  throws(() => validateState({ ...state, history: ["BOOK", "POOP"] }, puzzle, words));
  throws(() => validateState({ ...state, restarts: -1 }, puzzle, words));
  throws(() => validateState({ ...state, hints: [1, 2, 3] }, puzzle, words));
  throws(() => validateState({ ...state, hints: [{ word: "BOOK", target: "LOOT", letter: "AB" }] }, puzzle, words));
  const hint = { from: "BOOT", word: "LOOT", target: "POOP", label: "LO?T", backtrack: false };
  equal(validateState({ ...state, hints: [hint] }, puzzle, words).hints, [hint]);
  throws(() => validateState({ ...state, hints: [{ ...hint, from: "LOOP" }] }, puzzle, words));
  throws(() => validateState({ ...state, coalClaimed: "yes" }, puzzle, words));
  throws(() => validateState({ ...state, coalTurn: 99 }, puzzle, words));
  equal(validateState({ ...state, gaveUp: true }, puzzle, words).gaveUp, true);
  const legacy = { ...state };
  delete legacy.gaveUp;
  equal(validateState(legacy, puzzle, words), state);
  throws(() => validateState({ ...state, gaveUp: "yes" }, puzzle, words));
  throws(() => validateState({ ...state, history: ["BOOK", "BOOT", "LOOT", "LOOP", "POOP"], coalClaimed: true, coalTurn: 2, gaveUp: true }, puzzle, words));
  throws(() => saveTicket({ setItem() { throw new Error("Quota exceeded"); } }, key, ticket));
});

let catalog;
await test("Catalog validates a six-month preselected bank, including before-epoch dates", async () => {
  catalog = validateCatalog(await (await fetch("../data/puzzles.json")).json());
  equal(catalog.cycleDays, 182);
  const repeatedDate = new Date(Date.parse(`${catalog.epoch}T00:00:00Z`) + catalog.cycleDays * 86_400_000).toISOString().slice(0, 10);
  for (const length of [4, 5, 6]) {
    equal(catalog.modes[length].puzzles.length, catalog.cycleDays);
    equal(new Set(catalog.modes[length].puzzles.map(puzzle => `${puzzle.start}:${puzzle.goal}`)).size, catalog.cycleDays);
    equal(selectPuzzle(catalog, length, catalog.epoch), selectPuzzle(catalog, length, repeatedDate));
    equal(selectPuzzle(catalog, length, "2026-10-05"), catalog.modes[length].puzzles.at(-1));
  }
  throws(() => validateCatalog({ ...catalog, edition: undefined }));
  equal(catalog.wordPolicy, "scowl-american-60-v2");
  throws(() => validateCatalog({ ...catalog, wordPolicy: undefined }));
  throws(() => validateCatalog({ ...catalog, cycleDays: 0 }));
  throws(() => validateCatalog({ ...catalog, cycleDays: 181 }));
  throws(() => validateCatalog({ ...catalog, epoch: "2026-02-31" }));
  throws(() => selectPuzzle(catalog, 4, "2026-02-31"));
});
for (const length of [4, 5, 6]) {
  await test(`All ${catalog.cycleDays} ${length}-letter pars, edges, dictionaries, and least-common waypoint tickets`, async () => {
    const mode = catalog.modes[length];
    const text = await (await fetch(`../data/${mode.file}`)).text();
    const words = parseWords(text, length);
    equal(words.size, mode.wordCount);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    equal([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join(""), mode.sha256);
    for (const word of {
      4: ["HONE", "TACO", "AWLS", "WILY", "NAPE", "OMIT"],
      5: ["HONED", "HONES", "TACOS", "MOTIF", "SINEW", "GNOME", "EPOCH"],
      6: ["HONING", "ENIGMA", "FERRET", "THORNY"],
    }[length]) assert(words.has(word), `Missing ordinary English word: ${word}`);
    const [before, after, goal] = {
      4: ["HOME", "HONE", "MINT"],
      5: ["HONES", "HONED", "GLASS"],
      6: ["HOPING", "HONING", "STARED"],
    }[length];
    equal(makeMove([before], after, { goal }, words), [before, after]);
    if (length === 4) equal(makeMove(["TACK"], "TACO", { goal }, words), ["TACK", "TACO"]);
    if (length === 5) equal(makeMove(["TACKS"], "TACOS", { goal }, words), ["TACKS", "TACOS"]);
    for (const word of ["STANE", "STANES", "STANED", "STANKS", "RAGOUT", "HERR", "SHAN", "UNTO", "HITHER", "THEE", "THOU", "THINE", "XXIV", "DEPT", "MISC", "ACCT"]) assert(!words.has(word));
    if (length === 5) throws(() => makeMove(["STARE"], "STANE", { goal: "CROWN" }, words));
    if (length === 6) {
      throws(() => makeMove(["STARES"], "STANES", { goal: "SHOCKS" }, words));
      throws(() => makeMove(["STARED"], "STANED", { goal: "SHOCKS" }, words));
    }
    const graph = new WordGraph(words, mode.ranks);
    const goals = new Set(mode.puzzles.map(puzzle => puzzle.goal));
    for (const goal of goals) {
      graph.target(goal);
      for (const puzzle of mode.puzzles.filter(puzzle => puzzle.goal === goal)) {
        equal(graph.distance.get(puzzle.start), puzzle.par);
        assert([...puzzle.start].filter((letter, i) => letter === puzzle.goal[i]).length <= (length === 6 ? 1 : 0));
        assert(!("solution" in puzzle));
        const path = graph.preferredPath(puzzle.start);
        const hint = graph.ticket(puzzle.start, [puzzle.start]);
        assert(path.slice(1, -1).includes(hint.word));
        equal(graph.ranks.get(hint.word), Math.max(...path.slice(1, -1).map(word => graph.ranks.get(word))));
        equal([...hint.label].filter(letter => letter === "?").length, length === 6 ? 2 : 1);
        assert(hint.label.includes("?") && !hint.label.includes(hint.word));
        const onward = graph.distance.get(puzzle.coal.word);
        graph.target(puzzle.coal.word);
        assert(graph.distance.get(puzzle.start) + onward - 1 <= puzzle.par);
        graph.target(goal);
        assert(path.every(word => words.has(word)));
        for (let i = 0; i < path.length - 1; i++) {
          changedPosition(path[i], path[i + 1]);
          const word = path[i];
          const candidates = new Set(graph.optimalNext(word).map(next => next[changedPosition(word, next)]));
          const letters = graph.trackLetters(word);
          assert(letters.length >= 1 && letters.length <= 2);
          assert(letters.every(letter => candidates.has(letter)));
        }
      }
    }
  });
}
await test("Smudged tickets prefer unfamiliar unvisited waypoints without revealing the route", () => {
  const words = new Set(["BOOK", "BOOT", "LOOT", "LOOP", "POOP"]);
  const graph = new WordGraph(words, [10, 20, 50_001, 30, 10]);
  graph.target("POOP");
  const ticket = graph.ticket("BOOK", ["BOOK"]);
  equal(ticket.word, "LOOT");
  equal([...ticket.label].filter(letter => letter === "?").length, 1);
  assert(!("path" in ticket));
  equal(graph.ticket("LOOP", ["BOOK", "BOOT", "LOOT", "LOOP"]), null);
  throws(() => requestTicketHint(freshState({ start: "BOOK" }), { start: "BOOK", goal: "POOP", coal: { word: "LOOT" } }, { ...ticket, label: "????" }));
});
await test("Module worker agrees on par and returns a masked waypoint rather than a solution", async () => {
  const puzzle = catalog.modes[4].puzzles[0];
  const text = await (await fetch("../data/words4.txt")).text();
  const client = new RouteClient();
  try {
    equal((await client.request({ type: "load", text, ranks: catalog.modes[4].ranks, length: 4, goal: puzzle.goal, coal: puzzle.coal.word, start: puzzle.start })).par, puzzle.par);
    const clue = await client.request({ type: "hint", word: puzzle.start, history: [puzzle.start], excluded: [] });
    assert(clue.label.includes("?") && !("path" in clue));
  } finally { client.dispose(); }
});

const failed = results.filter(result => !result.ok);
globalThis.testResults = { passed: results.length - failed.length, failed: failed.length, results };
document.body.dataset.status = failed.length ? "failed" : "passed";
document.querySelector("#results").textContent = results.map(result => `${result.ok ? "PASS" : "FAIL"} ${result.name}${result.error ? "\n" + result.error : ""}`).join("\n") + `\n\n${results.length - failed.length} passed; ${failed.length} failed.`;
