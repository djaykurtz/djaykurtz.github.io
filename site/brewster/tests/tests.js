import { buildLedger, formatShort, formatTime, parseTime, summarize, tabAt, waterfall } from "../js/ledger.js";

const results = [];
function assert(value, message = "Assertion failed") { if (!value) throw new Error(message); }
function equal(a, b) { assert(a === b, `${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
function throws(fn) { let caught = false; try { fn(); } catch { caught = true; } assert(caught, "Expected rejection"); }
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); }
}

const tiny = {
  runtime: "10:00", budget: 100,
  events: [
    { t: "5:00", kind: "windfall", amount: -20, label: "back" },
    { t: "1:00", kind: "spend", amount: 50, label: "a" },
    { t: "0:30", kind: "milestone", amount: 0, label: "start" },
    { t: "9:00", kind: "spend", amount: 70, label: "b" },
  ],
};

await test("Times parse as m:ss, h:mm:ss and seconds; bad input is rejected", () => {
  equal(parseTime("54:10"), 3250);
  equal(parseTime("1:02:03"), 3723);
  equal(parseTime("101:30"), 6090);
  equal(parseTime(42), 42);
  throws(() => parseTime("1:75"));
  throws(() => parseTime("abc"));
  throws(() => parseTime(-1));
});

await test("Times format as total minutes and padded seconds", () => {
  equal(formatTime(0), "0:00");
  equal(formatTime(3250), "54:10");
  equal(formatTime(6090.9), "101:30");
});

await test("Short money labels", () => {
  equal(formatShort(1250000), "$1.25M");
  equal(formatShort(450000), "$450K");
  equal(formatShort(-2600000), "-$2.6M");
  equal(formatShort(20000), "$20K");
});

await test("Events are sorted and carry running totals, including windfalls", () => {
  const ledger = buildLedger(tiny);
  equal(ledger.events.map(e => e.label).join(","), "start,a,back,b");
  equal(ledger.events.map(e => e.total).join(","), "0,50,30,100");
  equal(ledger.final, 100);
});

await test("The tab at a timestamp includes events at that exact second", () => {
  const ledger = buildLedger(tiny);
  equal(tabAt(ledger, 0).total, 0);
  equal(tabAt(ledger, 0).latest, null);
  equal(tabAt(ledger, 59).total, 0);
  equal(tabAt(ledger, 60).total, 50);
  equal(tabAt(ledger, 300).total, 30);
  equal(tabAt(ledger, 300).remaining, 70);
  equal(tabAt(ledger, 600).total, 100);
  equal(tabAt(ledger, 600).progress, 1);
  equal(tabAt(ledger, 60).next.label, "back");
});

await test("Malformed events are rejected", () => {
  throws(() => buildLedger({ ...tiny, events: [{ t: "1:00", kind: "spend", amount: -5 }] }));
  throws(() => buildLedger({ ...tiny, events: [{ t: "1:00", kind: "windfall", amount: 5 }] }));
  throws(() => buildLedger({ ...tiny, events: [{ t: "1:00", kind: "milestone", amount: 5 }] }));
  throws(() => buildLedger({ ...tiny, events: [{ t: "11:00", kind: "spend", amount: 5 }] }));
  throws(() => buildLedger({ ...tiny, events: [{ t: "1:00", kind: "lunch", amount: 5 }] }));
});

await test("Amounts come from calc lines; a mismatched amount is rejected", () => {
  const ledger = buildLedger({ runtime: "10:00", budget: 100, events: [{ t: "1:00", kind: "spend", calc: [["a", 3, 10], ["b", 1, 5]], range: [20, 50] }] });
  equal(ledger.events[0].amount, 35);
  throws(() => buildLedger({ runtime: "10:00", budget: 100, events: [{ t: "1:00", kind: "spend", amount: 30, calc: [["a", 3, 10], ["b", 1, 5]] }] }));
  throws(() => buildLedger({ runtime: "10:00", budget: 100, events: [{ t: "1:00", kind: "spend", calc: [["a", 3, 10]], range: [40, 50] }] }));
});

await test("The plug closes the gap to the budget and inherits the opposite range", () => {
  const ledger = buildLedger({ runtime: "10:00", budget: 100, events: [
    { t: "1:00", kind: "spend", calc: [["a", 1, 50]], range: [40, 70] },
    { t: "2:00", kind: "windfall", calc: [["back", 1, -10]], range: [-20, -5] },
    { t: "3:00", kind: "spend", plug: true },
  ] });
  const plug = ledger.events.find(e => e.plug);
  equal(plug.amount, 60);
  equal(plug.range.join(","), "35,80");
  equal(ledger.final, 100);
  throws(() => buildLedger({ runtime: "10:00", budget: 40, events: [{ t: "1:00", kind: "spend", calc: [["a", 1, 50]] }, { t: "2:00", kind: "spend", plug: true }] }));
});

await test("Waterfall steps chain end to start, with the plug last", () => {
  const ledger = buildLedger({ runtime: "10:00", budget: 100, categories: { a: "A", plug: "Plug" }, events: [
    { t: "3:00", kind: "spend", category: "plug", plug: true },
    { t: "1:00", kind: "spend", category: "a", calc: [["x", 1, 50]], range: [40, 60] },
    { t: "2:00", kind: "windfall", category: "a", calc: [["y", 1, -10]], range: [-20, -5] },
  ] });
  const steps = waterfall(ledger);
  equal(steps.map(s => s.label).join(","), "A,Came back,Plug");
  equal(steps.map(s => `${s.start}>${s.end}`).join(","), "0>50,50>40,40>100");
  const s = summarize(ledger);
  equal(s.spent, 50); equal(s.cameBack, -10); equal(s.plug.amount, 60);
});

await test("Published ledger is valid and ends with exactly $30M spent", async () => {
  const response = await fetch("../data/ledger.json", { cache: "no-cache" });
  const ledger = buildLedger(await response.json());
  equal(ledger.budget, 30000000);
  equal(ledger.final, ledger.budget);
  assert(ledger.events.every(e => e.label && e.detail), "Every event needs a label and detail");
  assert(ledger.events.filter(e => e.kind !== "milestone").every(e => e.plug || e.calc), "Every priced event shows its working");
  assert(ledger.events.filter(e => e.kind !== "milestone").every(e => ledger.categories[e.category]), "Every priced event has a known category");
  equal(waterfall(ledger).at(-1).end, ledger.budget);
  assert(ledger.events.every(e => e.total <= ledger.budget * 1.1), "Running total strays far past the budget");
});

const failed = results.filter(r => !r.ok);
document.getElementById("results").textContent = results
  .map(r => `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.error}`}`)
  .join("\n") + `\n\n${results.length - failed.length}/${results.length} passed`;
document.title = failed.length ? `FAIL ${failed.length}` : "PASS";
