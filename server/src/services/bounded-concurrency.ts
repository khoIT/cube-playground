/**
 * Run an async mapper over a list with a hard cap on in-flight tasks.
 *
 * A fixed pool of workers pulls indices off a shared cursor, so at most `limit`
 * tasks run at once regardless of list size. Results land at their original
 * index (order-preserving) even though tasks resolve out of order. Used to fan
 * out per-card Cube loads without stampeding a warming pre-aggregation.
 */
export async function mapWithConcurrency<I, O>(
  items: readonly I[],
  limit: number,
  fn: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }

  const poolSize = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return out;
}
