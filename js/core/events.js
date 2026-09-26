// Tiny pub/sub bus. Used for cross-cutting, many-listener events (input, round,
// party). Sources use their own private instance for ready/state/error since
// only one source is ever active, see sources/source.js.
export class EventBus {
  constructor() {
    this._listeners = new Map(); // type -> Set<fn>
  }

  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }

  emit(type, detail) {
    const set = this._listeners.get(type);
    if (!set) return;
    // Copy before iterating: a listener may unsubscribe itself mid-emit.
    for (const fn of [...set]) {
      try {
        fn(detail);
      } catch (err) {
        console.error(`[events] listener for "${type}" threw`, err);
      }
    }
  }
}

// App-wide bus for input:*, round:*, party:* events.
export const bus = new EventBus();
