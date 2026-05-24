/**
 * In-app notification driver — persists to the `notifications` table.
 * Surfaced through the topbar bell via GET /api/chat/notifications.
 *
 * Fire-and-forget on send; errors logged but do not throw so the caller
 * (refresh handler, audit emitter) is not coupled to driver liveness.
 */

import type Database from 'better-sqlite3';
import * as monitoringStore from '../db/monitoring-store.js';
import type { Notification, NotificationDriver } from './notification-driver.js';

export class InAppNotificationDriver implements NotificationDriver {
  constructor(private readonly db: Database.Database) {}

  async send(notification: Notification): Promise<void> {
    try {
      monitoringStore.insertNotification(this.db, {
        id: notification.id,
        ownerId: notification.ownerId,
        kind: notification.kind,
        payload: notification.payload,
        createdAt: notification.createdAt,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[in-app-notification-driver] send failed',
        notification.kind,
        (err as Error).message,
      );
    }
  }
}
