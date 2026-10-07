import { changedPosition, feedback } from "./engine.js";

export class Journey {
  constructor(ui) {
    this.ui = ui;
    this.animation = null;
    this.hasRoute = false;
    this.motion = matchMedia("(prefers-reduced-motion: reduce)");
    window.addEventListener("resize", () => this.positionTrain());
    this.motion.addEventListener("change", () => this.positionTrain());
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.hasRoute) return;
      if (this.animation?.playState === "running") {
        this.updateTrackEnd(this.ui.routeMap.getBoundingClientRect());
      } else {
        this.positionTrain();
      }
    });
    this.resizeObserver.observe(this.ui.routeMap);
  }

  clear() {
    this.animation?.cancel();
    this.animation = null;
    this.hasRoute = false;
    this.ui.history.replaceChildren();
    for (const rail of [this.ui.trackRailPath, this.ui.trackBedPath, this.ui.trackTiesPath]) rail.removeAttribute("d");
    this.ui.train.hidden = true;
    this.ui.destinationStation.hidden = true;
    this.ui.coalStation.hidden = true;
    this.ui.currentStation.classList.remove("arrived");
    this.ui.currentStopLabel.textContent = "BOARDING";
  }

  render(history, goal, animate = false, coal, coalTurn = null, coalClaimed = false) {
    this.ui.history.replaceChildren();
    for (const [turn, word] of history.slice(0, -1).entries()) {
      const row = document.createElement("li");
      row.className = "visited-station";
      const node = document.createElement("span");
      node.className = "station-node";
      node.setAttribute("aria-hidden", "true");
      const body = document.createElement("div");
      const sign = document.createElement("span");
      sign.className = "station-sign";
      const free = turn === coalTurn;
      sign.textContent = `${String(turn).padStart(2, "0")}${free ? " / FREE" : ""}`;
      row.classList.toggle("coaling", free);
      const tiles = document.createElement("span");
      tiles.className = "station-tiles";
      tiles.setAttribute("role", "img");
      tiles.setAttribute("aria-label", word);
      const matches = feedback(word, goal);
      const changed = turn ? changedPosition(history[turn - 1], word) : -1;
      for (const [index, letter] of [...word].entries()) {
        const tile = document.createElement("span");
        tile.className = `station-tile ${matches[index]}${index === changed ? " changed" : ""}`;
        tile.textContent = letter;
        tile.setAttribute("aria-hidden", "true");
        tiles.append(tile);
      }
      const change = document.createElement("span");
      change.className = "visually-hidden";
      change.textContent = turn
        ? `Slot ${changed + 1}: ${history[turn - 1][changed]} to ${word[changed]}`
        : "Where your journey began";
      row.title = `${free ? "Coaling Station: one free landing. " : ""}${change.textContent}`;
      body.append(sign, tiles, change);
      row.append(node, body);
      this.ui.history.append(row);
    }
    const turn = history.length - 1;
    const won = history.at(-1) === goal;
    const free = turn === coalTurn;
    this.ui.currentStopLabel.textContent = `${String(turn).padStart(2, "0")} / ${won ? "HOME" : free ? "COALING STATION / FREE" : turn ? "YOU ARE HERE" : "DEPARTURE"}`;
    this.ui.currentStation.classList.toggle("arrived", won);
    this.ui.destinationStation.hidden = won;
    this.ui.coalStation.hidden = coalClaimed || won;
    this.ui.destinationWord.textContent = goal;
    this.hasRoute = true;
    this.positionTrain(animate);
    if (animate) {
      this.ui.currentStation.scrollIntoView({ block: "nearest", behavior: this.motion.matches ? "auto" : "smooth" });
    }
  }

  positionTrain(animate = false) {
    if (!this.hasRoute) return;
    this.animation?.cancel();
    this.animation = null;
    const map = this.ui.routeMap.getBoundingClientRect();
    const destination = this.ui.currentStation.querySelector(".station-node").getBoundingClientRect();
    const x = destination.left + destination.width / 2 - map.left - 15;
    const y = destination.top + destination.height / 2 - map.top - 15;
    this.updateTrackEnd(map);
    this.ui.train.hidden = false;
    this.ui.train.style.transform = `translate(${x}px, ${y}px)`;
    const previous = this.ui.history.querySelector("li:last-child .station-node");
    if (!animate || !previous || this.motion.matches) return;
    const origin = previous.getBoundingClientRect();
    const fromX = origin.left + origin.width / 2 - map.left - 15;
    const fromY = origin.top + origin.height / 2 - map.top - 15;
    const frames = [{ transform: `translate(${fromX}px, ${fromY}px)` }];
    if (Math.abs(fromX - x) > 1 && Math.abs(fromY - y) > 1) {
      const middle = (fromY + y) / 2;
      frames.push({ transform: `translate(${fromX}px, ${middle}px)` }, { transform: `translate(${x}px, ${middle}px)` });
    }
    frames.push({ transform: `translate(${x}px, ${y}px)` });
    this.animation = this.ui.train.animate(
      frames,
      { duration: 650, easing: "cubic-bezier(.25,.7,.25,1)" },
    );
  }

  updateTrackEnd(map) {
    const nodes = [...this.ui.history.querySelectorAll(".station-node"), this.ui.currentStation.querySelector(".station-node")];
    for (const station of [this.ui.coalStation, this.ui.destinationStation]) {
      if (!station.hidden) nodes.push(station.querySelector(".station-node"));
    }
    let previous;
    const segments = [];
    for (const node of nodes) {
      const box = node.getBoundingClientRect();
      const x = box.left + box.width / 2 - map.left;
      const y = box.top + box.height / 2 - map.top;
      if (!previous) segments.push(`M ${x} ${y}`);
      else {
        if (Math.abs(previous.x - x) > 1 && Math.abs(previous.y - y) > 1) {
          const middle = (previous.y + y) / 2;
          segments.push(`L ${previous.x} ${middle} L ${x} ${middle}`);
        }
        segments.push(`L ${x} ${y}`);
      }
      previous = { x, y };
    }
    this.ui.trackLines.setAttribute("viewBox", `0 0 ${map.width} ${map.height}`);
    const path = segments.join(" ");
    for (const rail of [this.ui.trackRailPath, this.ui.trackBedPath, this.ui.trackTiesPath]) rail.setAttribute("d", path);
  }
}
