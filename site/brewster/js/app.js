import { buildLedger, formatMoney, formatShort, formatTime, parseTime, peak, tabAt } from "./ledger.js";
import { renderAnalysis } from "./analysis.js";

const $ = id => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const ui = {
  form: $("timeForm"), minutes: $("minutes"), seconds: $("seconds"), slider: $("slider"),
  play: $("play"), speed: $("speed"), total: $("total"), remaining: $("remaining"), percent: $("percent"),
  barFill: $("barFill"), tape: $("tape"), latest: $("latest"), chart: $("chart"), tooltip: $("tooltip"),
  rows: $("ledgerRows"), marks: $("sliderMarks"), runtimeLabel: $("runtimeLabel"), draft: $("draftNote"),
};

let ledger, now = 0, playing = false, lastFrame = 0, shownTotal = 0, counterFrame = 0, tapeKey = -1;
let chart = null;

start().catch(error => {
  ui.latest.innerHTML = "";
  ui.latest.append(el("p", "latest-empty", `The ledger could not be opened: ${error.message}. Reload to try again.`));
});

async function start() {
  const response = await fetch("./data/ledger.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  ledger = buildLedger(await response.json());

  if (ledger.status === "draft" && ledger.statusNote) { ui.draft.textContent = ledger.statusNote; ui.draft.hidden = false; }
  ui.slider.max = String(ledger.runtime);
  ui.minutes.max = String(Math.floor(ledger.runtime / 60));
  ui.runtimeLabel.textContent = formatTime(ledger.runtime);

  buildSliderMarks();
  buildTable();
  chart = buildChart();
  new ResizeObserver(() => { chart = buildChart(); paintChart(); }).observe(ui.chart.parentElement);
  wireControls();
  renderAnalysis(ledger);

  setTime(timeFromHash() ?? 0, { instant: true, quiet: true });
}

/* ---------- controls ---------- */

function wireControls() {
  ui.form.addEventListener("submit", event => event.preventDefault());
  const fromFields = () => {
    const minutes = clampInt(ui.minutes.value, 0, 999), seconds = clampInt(ui.seconds.value, 0, 9999);
    setTime(minutes * 60 + seconds, { editing: document.activeElement });
  };
  ui.minutes.addEventListener("input", fromFields);
  ui.seconds.addEventListener("input", fromFields);
  ui.minutes.addEventListener("change", () => syncFields(null));
  ui.seconds.addEventListener("change", () => syncFields(null));
  ui.slider.addEventListener("input", () => { stop(); setTime(Number(ui.slider.value)); });
  ui.play.addEventListener("click", () => (playing ? stop() : play()));
  addEventListener("hashchange", () => { const t = timeFromHash(); if (t !== null && t !== now) setTime(t); });
}

function clampInt(value, min, max) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

function play() {
  if (now >= ledger.runtime) setTime(0, { instant: true });
  playing = true;
  ui.play.setAttribute("aria-pressed", "true");
  ui.play.textContent = "❚❚ Pause";
  lastFrame = performance.now();
  requestAnimationFrame(tick);
}

function stop() {
  if (!playing) return;
  playing = false;
  ui.play.setAttribute("aria-pressed", "false");
  ui.play.textContent = "▶ Roll film";
  writeHash();
}

function tick(frame) {
  if (!playing) return;
  const elapsed = (frame - lastFrame) / 1000;
  lastFrame = frame;
  const next = Math.min(ledger.runtime, now + elapsed * Number(ui.speed.value));
  setTime(next, { quiet: true });
  if (next >= ledger.runtime) stop(); else requestAnimationFrame(tick);
}

function timeFromHash() {
  const match = /(?:^|[#&])t=([\d:]+)/.exec(location.hash);
  if (!match) return null;
  try { return Math.min(parseTime(match[1]), ledger.runtime); } catch { return null; }
}

function writeHash() {
  history.replaceState(null, "", `#t=${formatTime(now)}`);
}

/* ---------- the one update path ---------- */

function setTime(seconds, { instant = false, quiet = false, editing = null } = {}) {
  now = Math.min(ledger.runtime, Math.max(0, seconds));
  const whole = Math.floor(now);
  const tab = tabAt(ledger, whole);

  syncFields(editing);
  ui.slider.value = String(whole);
  ui.slider.setAttribute("aria-valuetext", `${formatTime(whole)}, ${formatMoney(tab.total)} spent`);

  animateTotal(tab.total, instant || playing);
  ui.remaining.textContent = formatMoney(tab.remaining);
  ui.percent.textContent = `${(tab.progress * 100).toFixed(1).replace(/\.0$/, "")}%`;
  ui.barFill.style.transform = `scaleX(${tab.progress})`;
  document.body.classList.toggle("paid", tab.remaining <= 0);

  if (tapeKey !== tab.seen) { tapeKey = tab.seen; renderTape(tab); renderLatest(tab); renderTableState(tab); }
  paintChart(tab);
  if (!quiet && !playing) writeHash();
}

// Rewrite both fields from `now`, except the one the visitor is typing in.
function syncFields(editing) {
  const whole = Math.floor(now);
  if (editing !== ui.minutes) ui.minutes.value = String(Math.floor(whole / 60));
  if (editing !== ui.seconds) ui.seconds.value = String(whole % 60).padStart(2, "0");
}

function animateTotal(target, instant) {
  cancelAnimationFrame(counterFrame);
  if (instant || reducedMotion.matches) { shownTotal = target; ui.total.textContent = formatMoney(target); return; }
  const from = shownTotal, began = performance.now(), duration = 650;
  const step = frame => {
    const p = Math.min(1, (frame - began) / duration), eased = 1 - (1 - p) ** 3;
    shownTotal = from + (target - from) * eased;
    ui.total.textContent = formatMoney(shownTotal);
    if (p < 1) counterFrame = requestAnimationFrame(step);
  };
  counterFrame = requestAnimationFrame(step);
}

/* ---------- ticker tape and latest entry ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tapeItem(event) {
  const item = el("span", `tape-item tape-${event.kind}`);
  item.append(el("span", "tape-time", formatTime(event.t)));
  item.append(el("span", "tape-name", event.label.toUpperCase()));
  if (event.kind === "spend") item.append(el("span", "tape-amt", `▲ ${formatShort(event.amount)}`));
  else if (event.kind === "windfall") item.append(el("span", "tape-amt", `▼ ${formatShort(-event.amount)} BACK`));
  else item.append(el("span", "tape-amt", "○"));
  return item;
}

function renderTape(tab) {
  const seen = ledger.events.slice(0, tab.seen).reverse();
  const items = seen.length ? seen.map(tapeItem) : [el("span", "tape-item tape-idle", "MARKET CLOSED · MONTY IS STILL BROKE · ROLL THE FILM")];
  const status = el("span", "tape-item tape-total", `TAB ${formatShort(tab.total)} · LEFT ${formatShort(tab.remaining)}`);
  const run = el("span", "tape-run");
  run.append(status, ...items);
  ui.tape.replaceChildren(run, run.cloneNode(true));
  ui.tape.style.animationDuration = `${Math.max(18, (items.length + 1) * 6)}s`;
}

function renderLatest(tab) {
  ui.latest.replaceChildren();
  const event = tab.latest;
  if (!event) {
    ui.latest.append(el("p", "latest-empty", "Nothing on the tab yet. Monty is still pitching for gas money."));
  } else {
    const head = el("div", "latest-head");
    head.append(el("span", "latest-time", formatTime(event.t)), el("h2", "latest-title", event.label));
    const amount = event.kind === "spend" ? `+${formatMoney(event.amount)}`
      : event.kind === "windfall" ? `${formatMoney(event.amount)} (came back)` : "Story beat";
    head.append(el("span", `latest-amt amt-${event.kind}`, amount));
    ui.latest.append(head, el("p", "latest-detail", event.detail));
  }
  if (tab.next) {
    const next = el("button", "latest-next");
    next.type = "button";
    next.textContent = `Next: ${tab.next.label} at ${formatTime(tab.next.t)} →`;
    next.addEventListener("click", () => { stop(); setTime(tab.next.t); });
    ui.latest.append(next);
  }
}

/* ---------- ledger table ---------- */

function buildTable() {
  ui.rows.replaceChildren(...ledger.events.map(event => {
    const row = el("tr", `row-${event.kind}`);
    const jump = el("button", "jump", formatTime(event.t));
    jump.type = "button";
    jump.setAttribute("aria-label", `Jump to ${formatTime(event.t)}`);
    jump.addEventListener("click", () => { stop(); setTime(event.t); });
    const time = el("td"); time.append(jump);
    const what = el("td");
    what.append(el("span", "entry-label", event.label), el("span", "entry-detail", event.detail));
    if (event.calc || event.plug) what.append(workings(event));
    const amount = el("td", `num amt-${event.kind}`, event.kind === "milestone" ? "\u00B7" : formatShort(event.amount));
    const total = el("td", "num");
    total.append(el("span", "full", formatMoney(event.total)), el("span", "short", formatShort(event.total)));
    row.append(time, what, amount, total);
    event.row = row;
    return row;
  }));
}

// The formula behind an amount, shown under its description.
function workings(event) {
  const list = el("ul", "workings");
  if (event.plug) {
    list.append(el("li", "", `$30,000,000 minus everything else = ${formatMoney(event.amount)}`));
  } else {
    for (const [what, qty, each] of event.calc) {
      list.append(el("li", "", qty === 1 ? `${what}: ${formatMoney(each)}` : `${what}: ${qty.toLocaleString("en-US")} \u00D7 ${formatMoney(each)}`));
    }
  }
  list.append(el("li", "range", `Range ${formatShort(event.range[0])} to ${formatShort(event.range[1])}`));
  return list;
}

function renderTableState(tab) {
  ledger.events.forEach((event, i) => {
    event.row.classList.toggle("past", i < tab.seen);
    event.row.classList.toggle("current", i === tab.seen - 1);
  });
}

function buildSliderMarks() {
  ui.marks.replaceChildren(...ledger.events.filter(e => e.kind !== "milestone").map(event => {
    const mark = el("span", `mark mark-${event.kind}`);
    mark.style.left = `${(event.t / ledger.runtime) * 100}%`;
    return mark;
  }));
}

/* ---------- chart ---------- */

function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (parent) parent.append(node);
  return node;
}

function buildChart() {
  const root = ui.chart;
  const width = Math.max(280, root.parentElement.clientWidth);
  const height = width < 560 ? 240 : 320;
  const m = { top: 18, right: 14, bottom: 30, left: width < 560 ? 46 : 58 };
  const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
  const yMax = peak(ledger) * 1.08;
  const x = t => m.left + (t / ledger.runtime) * iw;
  const y = v => m.top + ih - (Math.max(0, v) / yMax) * ih;

  root.replaceChildren();
  root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  root.setAttribute("width", width);
  root.setAttribute("height", height);

  const defs = svg("defs", {}, root);
  const clip = svg("clipPath", { id: "pastClip" }, defs);
  const clipRect = svg("rect", { x: 0, y: 0, width: m.left, height }, clip);

  const grid = svg("g", { class: "grid" }, root);
  const yStep = 10_000_000;
  for (let v = 0; v <= yMax; v += yStep) {
    svg("line", { x1: m.left, x2: m.left + iw, y1: y(v), y2: y(v) }, grid);
    svg("text", { x: m.left - 8, y: y(v), "text-anchor": "end", "dominant-baseline": "middle" }, grid).textContent = v ? `$${v / 1e6}M` : "$0";
  }
  const xStep = width < 560 ? 30 * 60 : 15 * 60;
  for (let t = 0; t <= ledger.runtime; t += xStep) {
    svg("text", { x: x(t), y: m.top + ih + 20, "text-anchor": t === 0 ? "start" : "middle" }, grid).textContent = formatTime(t);
  }
  svg("line", { class: "axis", x1: m.left, x2: m.left + iw, y1: y(0), y2: y(0) }, root);

  const finish = svg("g", { class: "finish" }, root);
  svg("line", { x1: m.left, x2: m.left + iw, y1: y(ledger.budget), y2: y(ledger.budget) }, finish);
  svg("text", { x: m.left + 6, y: y(ledger.budget) - 7 }, finish).textContent = "$30M finish line";

  // Step path: hold each total until the next event, then jump.
  let d = `M${x(0)},${y(0)}`;
  for (const event of ledger.events) d += `H${x(event.t)}V${y(event.total)}`;
  d += `H${x(ledger.runtime)}`;
  const area = `${d}V${y(0)}H${x(0)}Z`;

  svg("path", { class: "line-future", d }, root);
  const past = svg("g", { "clip-path": "url(#pastClip)" }, root);
  svg("path", { class: "area-past", d: area }, past);
  svg("path", { class: "line-past", d }, past);

  const marks = svg("g", { class: "marks" }, root);
  const markNodes = ledger.events.map(event => {
    const cx = x(event.t), cy = y(event.total);
    const shape = event.kind === "milestone"
      ? svg("circle", { cx, cy, r: 4.5 }, marks)
      : svg("path", { d: event.kind === "spend" ? `M${cx},${cy - 6}L${cx + 5.5},${cy + 4}L${cx - 5.5},${cy + 4}Z` : `M${cx},${cy + 6}L${cx + 5.5},${cy - 4}L${cx - 5.5},${cy - 4}Z` }, marks);
    shape.setAttribute("class", `mk mk-${event.kind}`);
    return shape;
  });

  const cursor = svg("g", { class: "cursor" }, root);
  const cursorLine = svg("line", { y1: m.top, y2: m.top + ih }, cursor);
  const cursorDot = svg("circle", { r: 5 }, cursor);
  const hoverLine = svg("line", { class: "hover-line", y1: m.top, y2: m.top + ih, visibility: "hidden" }, root);

  const overlay = svg("rect", { class: "overlay", x: m.left, y: 0, width: iw, height }, root);
  const timeAt = clientX => {
    const box = root.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * width;
    return Math.round(Math.min(1, Math.max(0, (px - m.left) / iw)) * ledger.runtime);
  };
  let dragging = false;
  overlay.addEventListener("pointerdown", event => { dragging = true; overlay.setPointerCapture(event.pointerId); stop(); setTime(timeAt(event.clientX)); });
  overlay.addEventListener("pointerup", () => { dragging = false; });
  overlay.addEventListener("pointercancel", () => { dragging = false; });
  overlay.addEventListener("pointermove", event => {
    const t = timeAt(event.clientX);
    if (dragging) setTime(t, { quiet: true });
    showTooltip(t, x(t), event.pointerType);
  });
  overlay.addEventListener("pointerleave", () => { ui.tooltip.hidden = true; hoverLine.setAttribute("visibility", "hidden"); if (!dragging) writeHash(); });

  function showTooltip(t, px, pointerType) {
    if (pointerType === "touch" && !dragging) return;
    const tab = tabAt(ledger, t);
    hoverLine.setAttribute("x1", px); hoverLine.setAttribute("x2", px); hoverLine.setAttribute("visibility", "visible");
    ui.tooltip.replaceChildren(
      el("strong", "", formatTime(t)),
      el("span", "tip-total", `Tab ${formatMoney(tab.total)}`),
      el("span", "tip-last", tab.latest ? `Last: ${tab.latest.label}` : "Nothing spent yet"),
    );
    ui.tooltip.hidden = false;
    const scale = root.getBoundingClientRect().width / width;
    const left = px * scale, tipWidth = ui.tooltip.offsetWidth, boxWidth = root.getBoundingClientRect().width;
    ui.tooltip.style.left = `${Math.min(boxWidth - tipWidth, Math.max(0, left - tipWidth / 2))}px`;
  }

  return { x, y, clipRect, cursorLine, cursorDot, markNodes, height };
}

function paintChart(tab = tabAt(ledger, Math.floor(now))) {
  if (!chart) return;
  const px = chart.x(now);
  chart.clipRect.setAttribute("width", px);
  chart.cursorLine.setAttribute("x1", px); chart.cursorLine.setAttribute("x2", px);
  chart.cursorDot.setAttribute("cx", px); chart.cursorDot.setAttribute("cy", chart.y(tab.total));
  chart.markNodes.forEach((node, i) => node.classList.toggle("lit", i < tab.seen));
}
