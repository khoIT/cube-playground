/**
 * Throttled fetch queue for dashboard tile Cube loads.
 * At most MAX_CONCURRENT requests run simultaneously; extras wait in queue.
 * Prevents 8 simultaneous Cube requests when a full dashboard mounts.
 */

const MAX_CONCURRENT = 3;

type Task = () => Promise<void>;

let running = 0;
const queue: Task[] = [];

function drain(): void {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const task = queue.shift()!;
    running++;
    task().finally(() => {
      running--;
      drain();
    });
  }
}

/**
 * Enqueue a Cube load function.
 * Returns a Promise that resolves/rejects when the task completes.
 */
export function enqueueTileFetch<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const task: Task = () =>
      fn().then(resolve, reject);
    queue.push(task);
    drain();
  });
}

/** Exposed for testing — current inflight count. */
export function getRunningCount(): number {
  return running;
}

/** Exposed for testing — pending queue length. */
export function getQueueLength(): number {
  return queue.length;
}
