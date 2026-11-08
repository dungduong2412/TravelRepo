/**
 * In-process lock per key: callers with the same key run one after the other (a failure in one never blocks the next).
 * Used where an operation is "read current state, decide, write" and a repeated submission must see the first one's result
 * (profile saves, scan counting). One API instance runs per environment, so process scope is the right scope.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.tails.set(key, tail);
    try { return await run; } finally { if (this.tails.get(key) === tail) this.tails.delete(key); }
  }
}
