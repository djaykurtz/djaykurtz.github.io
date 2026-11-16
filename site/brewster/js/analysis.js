// The "show your work" section: summary tiles, the waterfall and the range chart.
import { formatMoney, formatShort, formatTime, summarize, waterfall } from "./ledger.js";

const SVG = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (parent) parent.append(node);
  return node;
}

function text(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

const percent = (part, whole) => `${Math.round((part / whole) * 100)}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const width = event => event.range[1] - event.range[0];

/** Priced entries (not the plug), widest low-to-high range first. */
function byUncertainty(ledger) {
  return ledger.events.filter(event => event.range && !event.plug && event.kind !== "milestone").sort((a, b) => width(b) - width(a));
}

const span = ([low, high]) => `${formatShort(low)} to ${formatShort(high)}`;

export function renderAnalysis(ledger) {
  renderStats(ledger);
  const draw = () => { drawWaterfall(ledger); drawRanges(ledger); };
  draw();
  new ResizeObserver(draw).observe(document.getElementById("waterfall").parentElement);
}

/* ---------- tiles and the plug callout ---------- */

function renderStats(ledger) {
  const s = summarize(ledger);
  const set = (name, value) => document.querySelectorAll(`[data-stat="${name}"]`).forEach(node => { node.textContent = value; });
  set("spent", formatShort(s.spent));
  set("spentNote", `across ${plural(s.spendCount, "priced entry", "priced entries")}`);
  set("cameBack", formatShort(s.cameBack));
  set("cameBackNote", `from ${plural(s.windfallCount, "deal", "deals")} that should have lost`);
  if (s.plug) {
    set("plug", formatShort(s.plug.amount));
    set("plugNote", `${percent(s.plug.amount, ledger.budget)} of the $30M, the balancing figure`);
    set("plugInline", formatMoney(s.plug.amount));
  }
  set("stated", `${s.stated} of ${s.priced}`);

  // Figures quoted in the rules section, so they follow the ledger.
  set("cameBackAbs", formatShort(-s.cameBack));
  const campaign = waterfall(ledger).find(step => step.key === "campaign");
  if (campaign) set("campaign", `about ${formatShort(Math.round(campaign.amount / 1e6) * 1e6)}`);
  const lastSpend = ledger.events.filter(event => event.kind === "spend").at(-1);
  if (lastSpend) { set("lastPayment", formatShort(lastSpend.amount)); set("lastPaymentTime", formatTime(lastSpend.t)); }


  const callout = document.getElementById("plugCallout");
  if (s.plug) {
    const [low, high] = s.plug.range;
    const allHigh = ledger.budget - low, allLow = ledger.budget - high;
    const items = byUncertainty(ledger), top = items.slice(0, 2);
    const share = top.reduce((t, e) => t + width(e), 0) / items.reduce((t, e) => t + width(e), 0);
    const leaders = `The ${top.map(e => e.label.toLowerCase()).join(" and the ")} account for ${percent(share, 1)} of that spread, so their prices are the first ones to check.`;
    callout.textContent = low < 0
      ? `The ranges are too wide to pin the plug down. If every entry came in at its high guess, the itemized spending alone would reach ${formatShort(allHigh)}, and Monty would overshoot by ${formatShort(-low)}. If every entry came in low, it would total ${formatShort(allLow)} and leave ${formatShort(high)} unexplained. ${leaders}`
      : `If every entry came in at its high guess, the plug would shrink to ${formatShort(low)}. If every entry came in low, it would grow to ${formatShort(high)}. ${leaders}`;
  }
}

/* ---------- shared tooltip for row charts ---------- */

function attachTooltip(root, rows, width) {
  const tip = root.parentElement.querySelector(".tooltip");
  const hide = () => { tip.hidden = true; };
  for (const { node, lines, x, y } of rows) {
    node.addEventListener("pointerenter", () => {
      tip.replaceChildren(text("strong", "", lines[0]), ...lines.slice(1).map(line => text("span", "", line)));
      tip.hidden = false;
      const scale = root.getBoundingClientRect().width / width;
      const box = root.getBoundingClientRect().width;
      tip.style.left = `${Math.min(box - tip.offsetWidth, Math.max(0, x * scale - tip.offsetWidth / 2))}px`;
      tip.style.top = `${Math.max(0, y * scale - tip.offsetHeight - 8)}px`;
    });
    node.addEventListener("pointerleave", hide);
  }
}

function frame(root, rows, rowHeight) {
  const width = Math.max(280, root.parentElement.clientWidth);
  const narrow = width < 560;
  const m = { top: 8, right: narrow ? 52 : 70, bottom: 26, left: narrow ? 104 : 168 };
  const height = m.top + m.bottom + rows * rowHeight;
  root.replaceChildren();
  root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  root.setAttribute("width", width);
  root.setAttribute("height", height);
  return { width, height, m, iw: width - m.left - m.right, narrow };
}

function axis(root, f, x, ticks, height) {
  const grid = svg("g", { class: "grid" }, root);
  for (const v of ticks) {
    svg("line", { x1: x(v), x2: x(v), y1: f.m.top, y2: height - f.m.bottom }, grid);
    svg("text", { x: x(v), y: height - f.m.bottom + 17, "text-anchor": "middle" }, grid).textContent = v === 0 ? "$0" : formatShort(v);
  }
}

function niceStep(span, target) {
  const raw = span / target, mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map(n => n * mag).find(step => step >= raw);
}

function ticksFor(min, max, target) {
  const step = niceStep(max - min, target), out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1; v += step) out.push(v);
  return out;
}

function rowLabel(root, f, y, label) {
  svg("text", { class: "row-label", x: f.m.left - 10, y, "text-anchor": "end", "dominant-baseline": "middle" }, root).textContent = label;
}

/* ---------- waterfall ---------- */

function drawWaterfall(ledger) {
  const root = document.getElementById("waterfall");
  const steps = waterfall(ledger);
  const rowHeight = 34;
  const f = frame(root, steps.length + 1, rowHeight);
  const top = Math.max(ledger.budget, ...steps.map(step => Math.max(step.start, step.end)));
  const x = v => f.m.left + (v / top) * f.iw;
  axis(root, f, x, ticksFor(0, top, f.narrow ? 3 : 6), f.height);

  const tips = [];
  steps.forEach((step, i) => {
    const y = f.m.top + i * rowHeight, mid = y + rowHeight / 2;
    const left = x(Math.min(step.start, step.end)), right = x(Math.max(step.start, step.end));
    const kind = step.plug ? "plug" : step.amount < 0 ? "windfall" : "spend";
    rowLabel(root, f, mid, step.label);
    if (i > 0) svg("line", { class: "wf-link", x1: x(step.start), x2: x(step.start), y1: y - 6, y2: y + 6 }, root);
    svg("rect", { class: `wf-bar wf-${kind}`, x: left, y: y + 6, width: Math.max(2, right - left), height: rowHeight - 12, rx: 3 }, root);
    svg("text", { class: "row-value", x: right + 6, y: mid, "dominant-baseline": "middle" }, root).textContent = formatShort(step.amount);
    const hit = svg("rect", { class: "hit", x: 0, y, width: f.width, height: rowHeight }, root);
    tips.push({ node: hit, x: (left + right) / 2, y: y + 6, lines: [
      step.label,
      `${formatMoney(step.amount)} (${plural(step.items.length, "entry", "entries")})`,
      `Tab goes from ${formatShort(step.start)} to ${formatShort(step.end)}`,
    ] });
  });

  const y = f.m.top + steps.length * rowHeight, mid = y + rowHeight / 2;
  const final = steps.at(-1)?.end ?? 0;
  rowLabel(root, f, mid, "Total");
  svg("rect", { class: "wf-bar wf-total", x: x(0), y: y + 6, width: Math.max(2, x(final) - x(0)), height: rowHeight - 12, rx: 3 }, root);
  svg("text", { class: "row-value row-total", x: x(final) + 6, y: mid, "dominant-baseline": "middle" }, root).textContent = formatShort(final);
  attachTooltip(root, tips, f.width);
}

/* ---------- range chart ---------- */

function drawRanges(ledger) {
  const root = document.getElementById("ranges");
  const items = byUncertainty(ledger);
  const rowHeight = 28;
  const f = frame(root, items.length, rowHeight);
  const min = Math.min(0, ...items.map(e => e.range[0])), max = Math.max(...items.map(e => e.range[1]));
  const x = v => f.m.left + ((v - min) / (max - min)) * f.iw;
  axis(root, f, x, ticksFor(min, max, f.narrow ? 3 : 6), f.height);
  svg("line", { class: "zero", x1: x(0), x2: x(0), y1: f.m.top, y2: f.height - f.m.bottom }, root);

  const tips = [];
  items.forEach((event, i) => {
    const y = f.m.top + i * rowHeight + rowHeight / 2;
    const kind = event.kind === "windfall" ? "windfall" : "spend";
    rowLabel(root, f, y, event.label);
    svg("rect", { class: `rg-bar rg-${kind}`, x: x(event.range[0]), y: y - 4, width: Math.max(2, x(event.range[1]) - x(event.range[0])), height: 8, rx: 4 }, root);
    svg("circle", { class: `rg-dot rg-dot-${kind}`, cx: x(event.amount), cy: y, r: 5 }, root);
    svg("text", { class: "row-value", x: f.width - f.m.right + 8, y, "dominant-baseline": "middle" }, root).textContent = formatShort(event.range[1] - event.range[0]);
    const hit = svg("rect", { class: "hit", x: 0, y: y - rowHeight / 2, width: f.width, height: rowHeight }, root);
    tips.push({ node: hit, x: x(event.amount), y: y - 6, lines: [event.label, `Estimate ${formatMoney(event.amount)}`, `Range ${span(event.range)}`] });
  });
  attachTooltip(root, tips, f.width);

  document.getElementById("rangeNote").textContent = "Widest spread at the top. The right-hand column is the gap between each entry's low and high guess.";
}
