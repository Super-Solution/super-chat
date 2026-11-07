// A tiny external store, consumed via useSyncExternalStore.
//
// Hand-rolled rather than pulling in zustand/valtio for two reasons: the state
// shape is already defined by the core's `RunState` reducer, and a chat thread
// under a streaming run notifies at token frequency — a store that allocates a
// new subscriber array per notify shows up in a profile at 60+ notifies/sec.

export type Listener = () => void;

export class Store<T> {
  private state: T;
  private listeners = new Set<Listener>();

  constructor(initial: T) {
    this.state = initial;
  }

  get = (): T => this.state;

  set = (next: T | ((prev: T) => T)): void => {
    const value = typeof next === "function" ? (next as (prev: T) => T)(this.state) : next;
    // Reference equality guard: a reducer that returns the same object (a
    // no-op event) must not wake every subscriber.
    if (Object.is(value, this.state)) return;
    this.state = value;
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
