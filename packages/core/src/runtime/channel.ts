// An async event channel: push from a callback, consume as an async iterable.
//
// Needed because tool execution is a plain `await`, not a generator, yet some
// events MUST reach the UI while a tool is still running:
//
//   • `awaiting-user` — a card asking for a decision. Buffering this until the
//     tool resolves deadlocks: the tool waits for the user, the user waits for
//     the card, and the card waits for the tool.
//   • `card` — progress updates from a long-running tool.
//   • `tool-result` — each call as it finishes, so a fast lookup is not held
//     back until the slowest call in the same step is done.
//
// Collecting events into an array and yielding them afterwards looks equivalent
// and is not. This is the fix.

export class EventChannel<T> {
  private queue: T[] = [];
  private waiting: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;

  /** Enqueue an event, handing it straight to a waiting consumer if there is one. */
  push(value: T): void {
    if (this.closed) return;
    const resolve = this.waiting.shift();
    if (resolve) resolve({ value, done: false });
    else this.queue.push(value);
  }

  /** No more events. Consumers drain what is buffered, then finish. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const resolve of this.waiting) resolve({ value: undefined as never, done: true });
    this.waiting = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        // Buffered events drain first, even after close, so nothing pushed
        // immediately before close() is lost.
        if (this.queue.length) return Promise.resolve({ value: this.queue.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiting.push(resolve));
      },
    };
  }
}
