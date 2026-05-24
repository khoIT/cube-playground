/**
 * emitMonitoringEvent — single entry point for phase-driven modules to
 * record a monitoring audit row and (optionally) dispatch a notification.
 *
 * Decoupled from the scheduler so phase-12 can call it from a refresh
 * handler without re-importing the cron driver.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import * as monitoringStore from '../db/monitoring-store.js';
import type { NotificationDriver } from './notification-driver.js';

export interface MonitoringEvent {
  action: string;
  actorId?: string;
  /** Logical id of the thing being monitored (e.g. monitored_segment id). */
  targetId?: string;
  detail?: Record<string, unknown>;
  /**
   * When set, also dispatches a user-facing notification to this owner.
   * Notification kind defaults to `action`; payload defaults to `detail`.
   */
  notify?: {
    ownerId: string;
    kind?: string;
    payload?: unknown;
  };
}

export interface EmitMonitoringDeps {
  db: Database.Database;
  driver: NotificationDriver;
}

export async function emitMonitoringEvent(
  deps: EmitMonitoringDeps,
  event: MonitoringEvent,
): Promise<void> {
  const at = Date.now();
  // Audit insert must not block on driver — fire-and-forget pattern.
  try {
    monitoringStore.insertMonitoringAudit(deps.db, {
      actorId: event.actorId,
      action: event.action,
      targetId: event.targetId,
      detail: event.detail,
      at,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[emit-monitoring-event] audit insert failed', (err as Error).message);
  }

  if (event.notify) {
    await deps.driver.send({
      id: randomUUID(),
      ownerId: event.notify.ownerId,
      kind: event.notify.kind ?? event.action,
      payload: event.notify.payload ?? event.detail ?? {},
      createdAt: at,
    });
  }
}
