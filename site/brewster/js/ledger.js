// Pure ledger logic: no DOM. Shared by the page and the browser checks.

export const KINDS = new Set(["spend", "windfall", "milestone"]);

/** "m:ss" or "h:mm:ss" (or a bare number of seconds) -> whole seconds. */
export function parseTime(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Bad time: ${value}`);
    return Math.floor(value);
  }
  const text = String(value).trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(text)) throw new Error(`Bad time: ${value}`);
  const parts = text.split(":").map(Number);
  if (parts.slice(1).some(part => part > 59)) throw new Error(`Bad time: ${value}`);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** Seconds -> "m:ss" using total minutes, the way people quote a film timestamp. */
export function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export function formatMoney(amount) { return dollars.format(Math.round(amount)); }

/** Short ticker form: $1.25M, $450K, $20K. */
export function formatShort(amount) {
  const abs = Math.abs(amount), sign = amount < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}$${trim(abs / 1e3)}K`;
  return `${sign}$${abs}`;
}
function trim(n) { return n.toFixed(2).replace(/\.?0+$/, ""); }

/** Validate raw JSON and return a sorted, normalised ledger with running totals. */
export function buildLedger(raw) {
  if (!raw || !Array.isArray(raw.events)) throw new Error("Ledger has no events");
  const budget = Number(raw.budget);
  if (!(budget > 0)) throw new Error("Ledger needs a positive budget");
  const runtime = parseTime(raw.runtime);
  const clock = raw.clock ? readClock(raw.clock, runtime) : null;
  const parsed = raw.events.map((event, index) => {
    if (!KINDS.has(event.kind)) throw new Error(`Event ${index}: unknown kind ${event.kind}`);
    const t = parseTime(event.t);
    if (t > runtime) throw new Error(`Event ${index}: ${event.t} is after the end of the film`);
    if (event.plug) {
      if (event.kind !== "spend") throw new Error(`Event ${index}: only a spend can be the plug`);
      return { ...event, index, t, amount: null, upfront: null, accrued: 0, rate: 0, days: 0, until: t };
    }
    const upfront = amountOf(event, index);
    const running = runningCost(event, index, t, clock);
    const amount = upfront + running.accrued;
    if (event.kind === "spend" && amount <= 0) throw new Error(`Event ${index}: a spend must be positive`);
    if (event.kind === "windfall" && amount >= 0) throw new Error(`Event ${index}: a windfall must be negative`);
    if (event.kind === "milestone" && amount !== 0) throw new Error(`Event ${index}: a milestone has no amount`);
    if (event.kind !== "spend" && running.accrued) throw new Error(`Event ${index}: only a spend can have daily costs`);
    const range = event.range ? event.range.map(Number) : event.kind === "milestone" ? null : [amount, amount];
    if (range && !(range[0] <= amount && amount <= range[1])) throw new Error(`Event ${index}: estimate is outside its range`);
    return { ...event, index, t, amount, upfront, ...running, range };
  });

  // The plug absorbs whatever the itemized estimates leave short of the budget.
  const plugs = parsed.filter(event => event.plug);
  if (plugs.length > 1) throw new Error("Only one event can be the plug");
  const priced = parsed.filter(event => !event.plug && event.range);
  const sum = pick => priced.reduce((total, event) => total + pick(event), 0);
  const itemized = sum(event => event.amount);
  if (plugs.length) {
    const plug = plugs[0];
    plug.amount = plug.upfront = budget - itemized;
    if (plug.amount <= 0) throw new Error("Itemized estimates already exceed the budget; there is nothing left for the plug");
    plug.range = [budget - sum(event => event.range[1]), budget - sum(event => event.range[0])];
  }

  const events = parsed.sort((a, b) => a.t - b.t || a.index - b.index);
  const ledger = { ...raw, budget, runtime, clock, events };
  for (const event of events) event.total = valueAt(ledger, event.t);
  ledger.final = valueAt(ledger, runtime);
  return ledger;
}

/**
 * The story's 30 days, laid evenly over a stretch of the film.
 * Running costs are charged by the day across that stretch.
 */
function readClock(clock, runtime) {
  const start = parseTime(clock.start), end = parseTime(clock.end), days = Number(clock.days);
  if (!(start < end && end <= runtime && days > 0)) throw new Error("Ledger clock needs start < end within the film, and a positive number of days");
  return { start, end, days, secondsPerDay: (end - start) / days };
}

/** Story days between two film times, rounded to whole days. */
export function storyDays(clock, from, to) {
  return Math.round((to - from) / clock.secondsPerDay);
}

/** Daily lines ([description, quantity, cost per day]) accrue from the event until `until` or the deadline. */
function runningCost(event, index, t, clock) {
  if (!event.daily) return { accrued: 0, rate: 0, days: 0, until: t };
  if (!clock) throw new Error(`Event ${index}: daily costs need a ledger clock`);
  const until = event.until ? parseTime(event.until) : clock.end;
  if (!(t >= clock.start && until > t && until <= clock.end)) throw new Error(`Event ${index}: daily costs must run forward inside the story clock`);
  const rate = event.daily.reduce((sum, line) => {
    if (!Array.isArray(line) || line.length !== 3 || !Number.isFinite(line[1]) || !Number.isFinite(line[2])) {
      throw new Error(`Event ${index}: each daily line is [description, quantity, cost per day]`);
    }
    return sum + line[1] * line[2];
  }, 0);
  const days = storyDays(clock, t, until);
  return { accrued: rate * days, rate, days, until };
}

/** An event's one-off cost: the sum of its calc lines (qty x unit price), or its stated amount. */
function amountOf(event, index) {
  if (Array.isArray(event.calc)) {
    const total = event.calc.reduce((sum, line) => {
      if (!Array.isArray(line) || line.length !== 3 || !Number.isFinite(line[1]) || !Number.isFinite(line[2])) {
        throw new Error(`Event ${index}: each calc line is [description, quantity, unit price]`);
      }
      return sum + line[1] * line[2];
    }, 0);
    if (event.amount !== undefined && !event.daily && Number(event.amount) !== total) throw new Error(`Event ${index}: amount doesn't match its calc`);
    return total;
  }
  if (event.daily) return 0;
  const amount = Number(event.amount ?? 0);
  if (!Number.isFinite(amount)) throw new Error(`Event ${index}: bad amount`);
  return amount;
}

/** Share of an event's running cost charged by film time `seconds` (straight line from start to finish). */
function accruedAt(event, seconds) {
  if (!event.accrued || seconds <= event.t) return 0;
  return event.accrued * Math.min(1, (seconds - event.t) / (event.until - event.t));
}

/** The tab at a film time: one-off costs already paid, plus running costs charged so far. */
export function valueAt(ledger, seconds) {
  let total = 0;
  for (const event of ledger.events) {
    if (event.t <= seconds) total += event.upfront ?? event.amount ?? 0;
    total += accruedAt(event, seconds);
  }
  return total;
}

/** Daily running costs active at a film time, in dollars per story day. */
export function rateAt(ledger, seconds) {
  return ledger.events.reduce((sum, event) => sum + (event.rate && event.t <= seconds && seconds < event.until ? event.rate : 0), 0);
}

/**
 * Points for the chart line. Between breakpoints the tab moves in a straight line,
 * and one-off payments jump straight up (or down) at their own time.
 */
export function curve(ledger) {
  const breaks = new Set([0, ledger.runtime]);
  for (const event of ledger.events) { breaks.add(event.t); breaks.add(event.until ?? event.t); }
  const points = [];
  for (const b of [...breaks].sort((a, z) => a - z)) {
    const after = valueAt(ledger, b);
    const before = after - ledger.events.reduce((sum, event) => sum + (event.t === b ? event.upfront ?? event.amount ?? 0 : 0), 0);
    if (before !== after) points.push([b, before]);
    points.push([b, after]);
  }
  return points;
}

/** Totals behind the method section: what's itemized, what came back, and the plug. */
export function summarize(ledger) {
  const priced = ledger.events.filter(event => event.kind !== "milestone");
  const spends = priced.filter(event => event.kind === "spend" && !event.plug);
  const windfalls = priced.filter(event => event.kind === "windfall");
  const plug = priced.find(event => event.plug) ?? null;
  const add = list => list.reduce((total, event) => total + event.amount, 0);
  return {
    spent: add(spends),
    spendCount: spends.length,
    cameBack: add(windfalls),
    windfallCount: windfalls.length,
    plug,
    stated: priced.filter(event => event.basis === "stated").length,
    priced: priced.length,
  };
}

/**
 * Waterfall steps in the order each category first appears in the film.
 * Money that came back is its own step, and the plug always comes last.
 */
export function waterfall(ledger) {
  const names = ledger.categories ?? {};
  const groups = new Map();
  for (const event of ledger.events) {
    if (event.kind === "milestone") continue;
    const key = event.kind === "windfall" ? "windfall" : event.category ?? "other";
    if (!groups.has(key)) {
      const label = key === "windfall" ? "Came back" : names[key] ?? key;
      groups.set(key, { key, label, amount: 0, low: 0, high: 0, items: [], plug: Boolean(event.plug) });
    }
    const group = groups.get(key);
    group.amount += event.amount;
    group.low += event.range[0];
    group.high += event.range[1];
    group.items.push(event);
  }
  const steps = [...groups.values()].sort((a, b) => a.plug - b.plug);
  let level = 0;
  for (const step of steps) { step.start = level; level += step.amount; step.end = level; }
  return steps;
}

/** The tab at a timestamp: the running total of every event at or before `seconds`. */
export function tabAt(ledger, seconds) {
  let lo = 0, hi = ledger.events.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ledger.events[mid].t <= seconds) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const event = found >= 0 ? ledger.events[found] : null;
  const total = valueAt(ledger, seconds);
  return {
    total,
    remaining: ledger.budget - total,
    progress: Math.min(1, Math.max(0, total / ledger.budget)),
    latest: event,
    seen: found + 1,
    next: ledger.events[found + 1] ?? null,
    rate: rateAt(ledger, seconds),
  };
}

/** Highest running total, for the chart's y scale. */
export function peak(ledger) {
  return curve(ledger).reduce((max, [, value]) => Math.max(max, value), ledger.budget);
}
