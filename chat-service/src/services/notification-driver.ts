/**
 * Notification driver interface — narrow on purpose so Q2 email/Slack
 * implementations can plug in without API churn.
 *
 * Q1 ships in-app only (decision Q5). The payload field is JSON so any
 * implementation can extend without altering this surface.
 */

export interface Notification {
  /** UUID assigned by caller (must be unique). */
  id: string;
  /** Recipient owner. */
  ownerId: string;
  /** Free-form classifier — e.g. `refresh_succeeded`, `refresh_failed`, `segment_deleted`. */
  kind: string;
  /** Free-form structured payload. Stored as JSON. */
  payload: unknown;
  /** Optional override (ms epoch). Defaults to Date.now(). */
  createdAt?: number;
}

export interface NotificationDriver {
  send(notification: Notification): Promise<void>;
}
