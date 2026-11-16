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
  let running = 0;
  const events = raw.events
    .map((event, index) => {
      if (!KINDS.has(event.kind)) throw new Error(`Event ${index}: unknown kind ${event.kind}`);
      const amount = Number(event.amount);
      if (!Number.isFinite(amount)) throw new Error(`Event ${index}: bad amount`);
      if (event.kind === "spend" && amount <= 0) throw new Error(`Event ${index}: a spend must be positive`);
      if (event.kind === "windfall" && amount >= 0) throw new Error(`Event ${index}: a windfall must be negative`);
      if (event.kind === "milestone" && amount !== 0) throw new Error(`Event ${index}: a milestone has no amount`);
      const t = parseTime(event.t);
      if (t > runtime) throw new Error(`Event ${index}: ${event.t} is after the end of the film`);
      return { ...event, index, t, amount };
    })
    .sort((a, b) => a.t - b.t || a.index - b.index)
    .map(event => ({ ...event, total: (running += event.amount) }));
  return { ...raw, budget, runtime, events, final: running };
}

/** The tab at a timestamp: the running total of every event at or before `seconds`. */
export function tabAt(ledger, seconds) {
  let lo = 0, hi = ledger.events.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ledger.events[mid].t <= seconds) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const event = found >= 0 ? ledger.events[found] : null;
  const total = event ? event.total : 0;
  return {
    total,
    remaining: ledger.budget - total,
    progress: Math.min(1, Math.max(0, total / ledger.budget)),
    latest: event,
    seen: found + 1,
    next: ledger.events[found + 1] ?? null,
  };
}

/** Highest running total, for the chart's y scale. */
export function peak(ledger) {
  return ledger.events.reduce((max, event) => Math.max(max, event.total), ledger.budget);
}
