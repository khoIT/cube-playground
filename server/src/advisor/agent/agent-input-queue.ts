/**
 * A push/pull async queue used as the SDK streaming-input source. The runtime
 * pushes one user message per turn; the SDK pulls them over the lifetime of a
 * single session. Closing the queue ends the underlying query() cleanly.
 *
 * Generic over the message type so it stays decoupled from SDK imports (the
 * runtime supplies the concrete SDKUserMessage shape).
 */
export class AsyncInputQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    let waiter = this.waiters.shift();
    while (waiter) {
      waiter({ value: undefined as unknown as T, done: true });
      waiter = this.waiters.shift();
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const item = this.buffer.shift();
        if (item !== undefined) {
          return Promise.resolve({ value: item, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
