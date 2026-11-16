import { buildLedger, curve, formatMoney, formatShort, formatTime, parseTime, peak, tabAt } from "./ledger.js?v=20261116h";
import { renderAnalysis } from "./analysis.js?v=20261116h";

const $ = id => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const ui = {
  form: $("timeForm"), minutes: $("minutes"), seconds: $("seconds"), slider: $("slider"),
  play: $("play"), speed: $("speed"), total: $("total"), remaining: $("remaining"), percent: $("percent"), rate: $("rate"),
  barFill: $("barFill"), tape: $("tape"), tapeStatus: $("tapeStatus"), tapeWindow: $("tapeWindow"), toast: $("toast"), latest: $("latest"), chart: $("chart"), tooltip: $("tooltip"),
  rows: $("ledgerRows"), marks: $("sliderMarks"), runtimeLabel: $("runtimeLabel"), draft: $("draftNote"),
};

/* ---------- collapsible sections ---------- */

// Which sections are open is a per-visitor convenience; the page works without storage.
const FOLD_KEY = "brewster-folds";
function readFolds() {
  try { return JSON.parse(localStorage.getItem(FOLD_KEY)) ?? {}; } catch { return {}; }
}
function setupFolds() {
  const saved = readFolds();
  for (const fold of document.querySelectorAll("details.fold")) {
    if (typeof saved[fold.id] === "boolean") fold.open = saved[fold.id];
    fold.addEventListener("toggle", () => {
      const state = readFolds();
      state[fold.id] = fold.open;
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
    });
  }
  // Links to a section open it first, without touching the #t= timestamp in the URL.
  document.addEventListener("click", event => {
    const link = event.target.closest('a[href^="#"]');
    const fold = link && document.getElementById(link.getAttribute("href").slice(1));
    if (!fold || fold.tagName !== "DETAILS") return;
    event.preventDefault();
    fold.open = true;
    fold.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
  });
}
setupFolds();

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
  new ResizeObserver(() => { if (tape.items.length) layoutTape(); }).observe(ui.tapeWindow);
  requestAnimationFrame(tapeTick);

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
  ui.rate.textContent = tab.rate ? `${formatShort(tab.rate)} a day` : "None yet";
  ui.barFill.style.transform = `scaleX(${tab.progress})`;
  document.body.classList.toggle("paid", tab.remaining <= 0);

  if (tapeKey !== tab.seen) {
    const previous = tapeKey;
    tapeKey = tab.seen;
    updateTape(tab, previous);
    renderLatest(tab);
    renderTableState(tab);
    // Pop a reaction when the film rolls forward onto an event, not while scrubbing around.
    if (tab.latest && previous >= 0 && tab.seen > previous && (playing || tab.seen - previous === 1)) showReaction(tab.latest);
  }
  const tabText = formatShort(tab.total), leftText = formatShort(tab.remaining);
  if (ui.tapeStatus.dataset.key !== tabText + leftText) {
    ui.tapeStatus.dataset.key = tabText + leftText;
    const line = (name, value) => { const b = el("b"); b.append(el("span", "", name), document.createTextNode(value)); return b; };
    ui.tapeStatus.replaceChildren(line("TAB", tabText), line("LEFT", leftText));
  }
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
  if (event.kind === "spend") item.append(el("span", "tape-amt", `▲ ${formatShort(event.amount)}${event.days ? ` OVER ${event.days} DAYS` : ""}`));
  else if (event.kind === "windfall") item.append(el("span", "tape-amt", `▼ ${formatShort(-event.amount)} BACK`));
  else item.append(el("span", "tape-amt", "○"));
  return item;
}

/** An event's ticker items: the entry, then its first reaction. */
function tapeEntries(event) {
  const items = [tapeItem(event)];
  const quip = event.react?.[0];
  if (quip) {
    const item = el("span", "tape-item tape-quip");
    item.append(el("span", "tape-who", quip[0]), el("span", "", `“${quip[1]}”`));
    items.push(item);
  }
  return items;
}

/*
 * The ticker is one run of items, repeated enough times to cover the window,
 * scrolled at a steady speed from script. New items are slotted in just past
 * the right edge, so the strip never restarts or jumps.
 */
const TAPE_SPEED = 70; // pixels per second
const tape = { items: [], offset: 0, width: 0, last: 0 };

function updateTape(tab, previous) {
  if (previous >= 1 && tab.seen === previous + 1 && tape.width) insertNewest(tab.latest);
  else rebuildTape(tab);
}

function rebuildTape(tab) {
  const seen = ledger.events.slice(0, tab.seen).reverse();
  tape.items = seen.length ? seen.flatMap(tapeEntries) : [el("span", "tape-item tape-idle", "MARKET CLOSED · MONTY IS STILL BROKE · ROLL THE FILM")];
  tape.offset = 0;
  layoutTape();
}

function layoutTape() {
  const run = el("span", "tape-run");
  run.append(...tape.items.map(node => node.cloneNode(true)));
  ui.tape.replaceChildren(run);
  tape.width = run.getBoundingClientRect().width;
  if (!reducedMotion.matches && tape.width) {
    const copies = Math.max(2, Math.ceil(ui.tapeWindow.clientWidth / tape.width) + 1);
    for (let i = 1; i < copies; i++) ui.tape.append(run.cloneNode(true));
    tape.offset %= tape.width;
  } else {
    tape.offset = 0;
  }
  paintTape();
}

function insertNewest(event) {
  const view = ui.tapeWindow.getBoundingClientRect();
  const nodes = [...ui.tape.querySelectorAll(".tape-item")];
  const per = tape.items.length;
  // Hold the leftmost visible item where it is while the strip is rebuilt.
  const anchor = Math.max(0, nodes.findIndex(node => node.getBoundingClientRect().right > view.left));
  const anchorX = nodes[anchor].getBoundingClientRect().left;
  // Slot the new items in front of the first item that hasn't reached the screen yet.
  const hidden = nodes.findIndex(node => node.getBoundingClientRect().left >= view.right);
  const at = (hidden < 0 ? nodes.length : hidden) % per;
  const fresh = tapeEntries(event);
  tape.items.splice(at, 0, ...fresh);
  layoutTape();
  const copy = Math.floor(anchor / per), pos = anchor % per;
  const moved = copy * tape.items.length + pos + (at <= pos ? fresh.length : 0);
  const after = ui.tape.querySelectorAll(".tape-item")[moved];
  if (after) {
    tape.offset = ((tape.offset + after.getBoundingClientRect().left - anchorX) % tape.width + tape.width) % tape.width;
    paintTape();
  }
}

function paintTape() {
  ui.tape.style.transform = `translate3d(${-tape.offset.toFixed(2)}px, 0, 0)`;
}

function tapeTick(frame) {
  const dt = tape.last ? Math.min(0.1, (frame - tape.last) / 1000) : 0;
  tape.last = frame;
  if (tape.width && !reducedMotion.matches) {
    tape.offset = (tape.offset + TAPE_SPEED * dt) % tape.width;
    paintTape();
  }
  requestAnimationFrame(tapeTick);
}

/* ---------- reactions ---------- */

let toastTimer = 0;
function showReaction(event) {
  const quip = event.react?.[0];
  if (!quip) return;
  ui.toast.replaceChildren(el("span", "toast-who", quip[0]), el("span", "toast-line", quip[1]));
  ui.toast.classList.remove("leaving");
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.classList.add("leaving");
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 260);
  }, playing ? 2600 : 3800);
}

function renderLatest(tab) {
  ui.latest.replaceChildren();
  const event = tab.latest;
  if (!event) {
    ui.latest.append(el("p", "latest-empty", "Nothing on the tab yet. Monty is still pitching for gas money."));
  } else {
    const head = el("div", "latest-head");
    head.append(el("span", "latest-time", formatTime(event.t)), el("h2", "latest-title", event.label));
    const amount = event.kind === "spend" ? `+${formatMoney(event.amount)}${event.days ? ` over ${event.days} days` : ""}`
      : event.kind === "windfall" ? `${formatMoney(event.amount)} (came back)` : "Story beat";
    head.append(el("span", `latest-amt amt-${event.kind}`, amount));
    ui.latest.append(head, el("p", "latest-detail", event.detail));
    // Film quotes appear only once they've been checked against the subtitles.
    if (event.quote?.text) {
      const quote = el("blockquote", "film-quote");
      quote.append(el("p", "", `“${event.quote.text}”`), el("cite", "", `${event.quote.who}, at ${event.quote.t ?? formatTime(event.t)}`));
      ui.latest.append(quote);
    }
    if (event.react?.length) {
      const list = el("ul", "reactions");
      for (const [who, line] of event.react) {
        const item = el("li");
        item.append(el("span", "who", who), document.createTextNode(line));
        list.append(item);
      }
      ui.latest.append(list);
    }
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
    if (event.calc || event.daily || event.plug) what.append(workings(event));
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
    for (const [what, qty, each] of event.calc ?? []) {
      list.append(el("li", "", qty === 1 ? `${what}: ${formatMoney(each)}` : `${what}: ${qty.toLocaleString("en-US")} \u00D7 ${formatMoney(each)}`));
    }
    for (const [what, qty, each] of event.daily ?? []) {
      const people = qty === 1 ? "" : `${qty.toLocaleString("en-US")} \u00D7 `;
      list.append(el("li", "daily", `${what}: ${people}${formatMoney(each)} a day \u00D7 ${event.days} days`));
    }
    if (event.days) list.append(el("li", "daily", `Charged daily from ${formatTime(event.t)} to ${formatTime(event.until)}`));
  }
  list.append(el("li", "range", `Range ${formatShort(event.range[0])} to ${formatShort(event.range[1])}`));
  list.append(el("li", "range", event.source === "plot"
    ? (event.basis === "stated" ? "Source: plot summary, amount included" : "Source: plot summary; amount estimated")
    : "Assumed: not in the plot summary"));
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

  // Straight lines between breakpoints: one-off costs jump, daily costs slope.
  const d = curve(ledger).map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("");
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
