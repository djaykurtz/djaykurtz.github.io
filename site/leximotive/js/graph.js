import { changedPosition } from "./engine.js";

export class WordGraph {
  constructor(words, ranks = []) {
    this.words = words;
    this.buckets = new Map();
    this.routes = new Map();
    this.ranks = new Map([...words].map((word, index) => [word, ranks[index] ?? 50_001]));
    for (const word of words) {
      for (let i = 0; i < word.length; i++) {
        const key = word.slice(0, i) + "*" + word.slice(i + 1);
        if (!this.buckets.has(key)) this.buckets.set(key, []);
        this.buckets.get(key).push(word);
      }
    }
  }

  neighbors(word) {
    const found = [];
    for (let i = 0; i < word.length; i++) {
      const key = word.slice(0, i) + "*" + word.slice(i + 1);
      for (const other of this.buckets.get(key) || []) if (other !== word) found.push(other);
    }
    return found;
  }

  target(goal) {
    if (!this.words.has(goal)) throw new Error("Target is missing from the dictionary.");
    this.goal = goal;
    if (this.routes.has(goal)) {
      const route = this.routes.get(goal);
      this.routes.delete(goal);
      this.routes.set(goal, route);
      this.distance = route.distance;
      this.counts = route.counts;
      return;
    }
    this.distance = new Map([[goal, 0]]);
    const order = [goal];
    for (let cursor = 0; cursor < order.length; cursor++) {
      const word = order[cursor];
      for (const other of this.neighbors(word)) {
        if (!this.distance.has(other)) {
          this.distance.set(other, this.distance.get(word) + 1);
          order.push(other);
        }
      }
    }
    this.counts = new Map([[goal, 1n]]);
    for (const word of order.slice(1)) {
      let count = 0n;
      for (const other of this.optimalNext(word)) count += this.counts.get(other);
      this.counts.set(word, count);
    }
    this.routes.set(goal, { distance: this.distance, counts: this.counts });
    if (this.routes.size > 2) this.routes.delete(this.routes.keys().next().value);
  }

  optimalNext(word) {
    const distance = this.distance.get(word);
    if (distance === undefined || distance === 0) return [];
    return this.neighbors(word).filter(other => this.distance.get(other) === distance - 1);
  }

  trackLetters(word) {
    if (!this.words.has(word) || !this.distance.has(word)) throw new Error("Current word has no route to the target.");
    const weights = new Map();
    for (const next of this.optimalNext(word)) {
      const letter = next[changedPosition(word, next)];
      weights.set(letter, (weights.get(letter) || 0n) + this.counts.get(next));
    }
    return [...weights].sort((a, b) => {
      if (a[1] !== b[1]) return a[1] > b[1] ? -1 : 1;
      return a[0].localeCompare(b[0]);
    }).slice(0, 2).map(([letter]) => letter).sort();
  }

  preferredPath(word, history = []) {
    if (!this.distance.has(word)) throw new Error("Current word has no route home.");
    const visited = new Set(history);
    const memo = new Map([[this.goal, { visits: 0, rarest: 0, cost: 0, path: [this.goal] }]]);
    const best = current => {
      if (memo.has(current)) return memo.get(current);
      const options = this.optimalNext(current).map(next => {
        const tail = best(next), rank = next === this.goal ? 0 : this.ranks.get(next);
        return { visits: tail.visits + Number(visited.has(next)), rarest: Math.max(rank, tail.rarest),
          cost: rank + tail.cost, path: [current, ...tail.path] };
      });
      options.sort((a, b) => a.visits - b.visits || a.cost - b.cost
        || a.rarest - b.rarest || a.path[1].localeCompare(b.path[1]));
      memo.set(current, options[0]);
      return options[0];
    };
    return best(word).path;
  }

  ticket(word, history, excluded = []) {
    const path = this.preferredPath(word, history);
    const known = new Set([...history, ...excluded]);
    const candidates = path.slice(1, -1).map((stop, index) => ({ word: stop, index: index + 1 }))
      .filter(stop => !known.has(stop.word));
    candidates.sort((a, b) => this.ranks.get(b.word) - this.ranks.get(a.word)
      || Math.abs(a.index - (path.length - 1) / 2) - Math.abs(b.index - (path.length - 1) / 2)
      || a.word.localeCompare(b.word));
    if (!candidates.length) return null;
    const waypoint = candidates[0].word;
    const seed = [...word + waypoint].reduce((sum, letter) => (Math.imul(sum, 31) + letter.charCodeAt(0)) >>> 0, 0);
    const hidden = new Set([seed % waypoint.length]);
    if (waypoint.length === 6) hidden.add((seed % waypoint.length + 3) % waypoint.length);
    return { from: word, target: this.goal, word: waypoint,
      label: [...waypoint].map((letter, index) => hidden.has(index) ? "?" : letter).join(""),
      backtrack: path.slice(1, -1).some(stop => history.includes(stop)) };
  }
}
