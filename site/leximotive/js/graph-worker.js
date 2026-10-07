import { parseWords } from "./engine.js";
import { WordGraph } from "./graph.js";

let graph;
let destination;
let targets;
let station;
self.addEventListener("message", ({ data }) => {
  try {
    if (data.type === "load") {
      graph = new WordGraph(parseWords(data.text, data.length), data.ranks);
      destination = data.goal;
      station = data.coal;
      targets = new Set([data.goal, data.coal]);
      graph.target(data.goal);
      const par = graph.distance.get(data.start);
      if (data.coal !== undefined) {
        const remaining = graph.distance.get(data.coal);
        graph.target(data.coal);
        const via = graph.distance.get(data.start) + remaining;
        if (!Number.isFinite(via) || via !== par) throw new Error("The Coaling Station is not on a shortest route.");
      }
      self.postMessage({ id: data.id, result: { par } });
    } else if (data.type === "hint") {
      if (!graph) throw new Error("The route engine is not ready.");
      graph.target(destination);
      self.postMessage({ id: data.id, result: graph.ticket(data.word, data.history, data.excluded) });
    } else if (data.type === "solution") {
      if (!graph) throw new Error("The route engine is not ready.");
      graph.target(station);
      const first = graph.preferredPath(data.word);
      graph.target(destination);
      self.postMessage({ id: data.id, result: [...first, ...graph.preferredPath(station).slice(1)] });
    } else if (data.type === "letters") {
      if (!graph) throw new Error("The route engine is not ready.");
      const target = data.target ?? destination;
      if (!targets.has(target)) throw new Error("Unknown hint destination.");
      graph.target(target);
      self.postMessage({ id: data.id, result: graph.trackLetters(data.word) });
    } else {
      throw new Error("Unknown route-engine request.");
    }
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
});
