export class RouteClient {
  constructor() {
    this.worker = new Worker(new URL("./graph-worker.js", import.meta.url), { type: "module" });
    this.pending = new Map();
    this.nextId = 0;
    this.failure = null;
    this.disposed = false;
    this.worker.addEventListener("message", ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      clearTimeout(request.timer);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.result);
    });
    this.worker.addEventListener("error", event => {
      const error = new Error(event.message || "The route worker could not start.");
      this.failure = error;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear();
    });
  }

  request(message) {
    return new Promise((resolve, reject) => {
      if (this.disposed) { reject(new DOMException("Puzzle switched.", "AbortError")); return; }
      if (this.failure) { reject(this.failure); return; }
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        const error = new Error("The route engine did not respond. Reload the journey to retry.");
        this.failure = error;
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
        this.pending.clear();
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ ...message, id }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  dispose() {
    this.disposed = true;
    this.worker.terminate();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new DOMException("Puzzle switched.", "AbortError"));
    }
    this.pending.clear();
  }
}
