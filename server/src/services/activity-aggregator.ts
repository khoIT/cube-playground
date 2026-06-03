/**
 * Activity aggregator — composes the append-only `activity_events` spine (main
 * DB) with chat-service usage stats into per-user and org-wide rollups for the
 * admin observability surface.
 *
 * Identity: events + segments key on Keycloak `sub`; the admin UI keys on
 * email. We resolve email→sub via `user_access.kc_sub` (the canonical map)
 * BEFORE calling chat-service, which keys on sub (= chat owner_id). A user
 * whose sub is unknown (invited, never logged in) simply has null chat counts —
 * never a silent zero that would falsely read as "inactive".
 *
 * Graceful degradation: chat stats are fetched with a timeout; on slow/down,
 * `chatStats` is null and the rollup still returns (counts shown as null).
 */

import { getDb } from '../db/sqlite.js';
import { listUsers, getAccess, normalizeEmail } from '../auth/access-store.js';
import {
  queryActivity,
  distinctActorsSince,
  topEventTargets,
  projectQueryShape,
} from './activity-store.js';
import { fetchChatStatsBySub, type ChatStatsBySub, type ChatUserStats } from './chat-stats-client.js';

/** A user is "inactive" when their last login is older than this many days. */
export const INACTIVE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface InactiveUser {
  email: string;
  lastLogin: string | null;
  status: string;
}

export interface ActivitySummary {
  usersByStatus: Record<string, number>;
  activeLast7d: number;
  activeLast30d: number;
  inactive: InactiveUser[];
  topFeatures: Array<{ feature: string; count: number }>;
  /** Total chat turns across all users; null if chat-service was unreachable. */
  totalChatTurns: number | null;
  generatedAt: number;
}

export interface UserActivity {
  email: string;
  sub: string | null;
  status: string;
  role: string;
  lastLogin: string | null;
  inactive: boolean;
  segmentCount: number;
  recentFeatures: string[];
  recentQueryShapes: ReturnType<typeof projectQueryShape>[];
  /** Chat usage for this user; null if chat-service was unreachable. */
  chatStats: ChatUserStats | null;
}

interface AggregatorOpts {
  /** Injectable clock (tests). Defaults to Date.now(). */
  now?: number;
  /** Injectable chat-stats fetcher (tests). Defaults to the HTTP client. */
  fetchChatStats?: typeof fetchChatStatsBySub;
}

function lastLoginFor(email: string): string | null {
  const row = getDb()
    .prepare('SELECT last_login FROM users WHERE LOWER(email) = ?')
    .get(normalizeEmail(email)) as { last_login: string | null } | undefined;
  return row?.last_login ?? null;
}

/** Parse a persisted query-shape detail; tolerate a malformed row (→ null)
 *  rather than 500 the admin route. Unreachable in practice (the only writer
 *  is the projector), but cheap insurance against a hand-edited/corrupt row. */
function parseShape(detailJson: string | null): ReturnType<typeof projectQueryShape> | null {
  if (!detailJson) return null;
  try {
    return JSON.parse(detailJson) as ReturnType<typeof projectQueryShape>;
  } catch {
    return null;
  }
}

function isInactive(lastLogin: string | null, now: number): boolean {
  if (!lastLogin) return true; // never logged in
  const t = Date.parse(lastLogin);
  if (isNaN(t)) return true;
  return now - t > INACTIVE_DAYS * DAY_MS;
}

export async function buildActivitySummary(opts: AggregatorOpts = {}): Promise<ActivitySummary> {
  const now = opts.now ?? Date.now();
  const fetchStats = opts.fetchChatStats ?? fetchChatStatsBySub;
  const db = getDb();
  const users = listUsers();

  const usersByStatus: Record<string, number> = {};
  for (const u of users) usersByStatus[u.status] = (usersByStatus[u.status] ?? 0) + 1;

  const activeLast7d = distinctActorsSince(db, now - 7 * DAY_MS).length;
  const activeLast30d = distinctActorsSince(db, now - 30 * DAY_MS).length;

  const inactive: InactiveUser[] = users
    .filter((u) => isInactive(u.lastLogin, now))
    .map((u) => ({ email: u.email, lastLogin: u.lastLogin, status: u.status }));

  const topFeatures = topEventTargets(db, 'feature_open', now - 30 * DAY_MS).map((t) => ({
    feature: t.targetId,
    count: t.count,
  }));

  // Resolve every user's sub for one bulk chat call (avoids N+1).
  const subs = users.map((u) => u.kcSub).filter((s): s is string => !!s);
  const chat: ChatStatsBySub = await fetchStats(subs, { fromMs: now - 30 * DAY_MS, toMs: now });
  const totalChatTurns =
    chat === null ? null : Object.values(chat).reduce((sum, s) => sum + (s.turns ?? 0), 0);

  return { usersByStatus, activeLast7d, activeLast30d, inactive, topFeatures, totalChatTurns, generatedAt: now };
}

export async function buildUserActivity(
  emailRaw: string,
  opts: AggregatorOpts = {},
): Promise<UserActivity | null> {
  const now = opts.now ?? Date.now();
  const fetchStats = opts.fetchChatStats ?? fetchChatStatsBySub;
  const email = normalizeEmail(emailRaw);

  const rec = getAccess(email);
  if (!rec) return null; // unknown user → 404 at the route

  const sub = rec.kcSub;
  const lastLogin = lastLoginFor(email);
  const db = getDb();

  const segmentCount = sub
    ? ((db.prepare('SELECT COUNT(*) AS n FROM segments WHERE owner = ?').get(sub) as { n: number }).n)
    : 0;

  const recentFeatures = sub
    ? queryActivity(db, { actorSub: sub, eventType: 'feature_open', limit: 10 })
        .map((r) => r.targetId)
        .filter((t): t is string => !!t)
    : [];

  const recentQueryShapes = sub
    ? queryActivity(db, { actorSub: sub, eventType: 'query_run', limit: 10 })
        .map((r) => parseShape(r.detailJson))
        .filter((s): s is ReturnType<typeof projectQueryShape> => s !== null)
    : [];

  // Chat stats only when we have a sub to key on; unknown sub → null (not zero).
  const chat = sub ? await fetchStats([sub], { fromMs: now - 30 * DAY_MS, toMs: now }) : null;
  const chatStats = chat ? (chat[sub!] ?? null) : null;

  return {
    email,
    sub,
    status: rec.status,
    role: rec.role,
    lastLogin,
    inactive: isInactive(lastLogin, now),
    segmentCount,
    recentFeatures,
    recentQueryShapes,
    chatStats,
  };
}
