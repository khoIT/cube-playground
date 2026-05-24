/**
 * chat-service scheduler — thin wrapper around node-cron (decision C4).
 *
 * Phases register handlers via `register(name, cron, handler)`. Phase-12
 * (saved monitored segments) is the first consumer; phase-05 owns the
 * registration API + lifecycle. Single-instance assumption — running
 * multiple chat-service replicas would double-fire jobs.
 */

import cron, { type ScheduledTask } from 'node-cron';

export type SchedulerHandler = () => Promise<void> | void;

export interface RegisteredJob {
  name: string;
  schedule: string;
  task: ScheduledTask;
}

class Scheduler {
  private jobs = new Map<string, RegisteredJob>();
  private started = false;

  /**
   * Register a new job. Re-registering with the same name replaces the
   * previous schedule + handler atomically.
   */
  register(name: string, schedule: string, handler: SchedulerHandler): void {
    if (!cron.validate(schedule)) {
      throw new Error(`scheduler.register: invalid cron expression: ${schedule}`);
    }
    const existing = this.jobs.get(name);
    if (existing) existing.task.stop();

    const task = cron.schedule(
      schedule,
      async () => {
        try {
          await handler();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[scheduler] handler "${name}" threw`, (err as Error).message);
        }
      },
      { scheduled: this.started },
    );
    this.jobs.set(name, { name, schedule, task });
  }

  /** Returns currently-registered job names (for health endpoint). */
  list(): Array<{ name: string; schedule: string }> {
    return Array.from(this.jobs.values()).map(({ name, schedule }) => ({ name, schedule }));
  }

  /** Start all registered jobs and mark new ones to start on register. */
  start(): void {
    this.started = true;
    for (const job of this.jobs.values()) job.task.start();
  }

  /** Stop all jobs without unregistering. */
  stop(): void {
    this.started = false;
    for (const job of this.jobs.values()) job.task.stop();
  }

  /** Test helper — clears every registration. */
  clear(): void {
    for (const job of this.jobs.values()) job.task.stop();
    this.jobs.clear();
    this.started = false;
  }
}

/** Process-wide singleton — phase-05 owns the instance. */
export const scheduler = new Scheduler();
