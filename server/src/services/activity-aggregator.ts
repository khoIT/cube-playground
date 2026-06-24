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
import { ownerSubsForEmail } from '../auth/principal.js';
import {
  queryActivity,
  distinctActorsSince,
  topEventTargets,
  projectQueryShape,
  parseQueryShape,
} from './activity-store.js';
import { fetchChatStatsBySub, type ChatStatsBySub, type ChatUserStats } from './chat-stats-client.js';
import { latestAuditForTarget } from '../auth/access-audit-store.js';

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
  /** Most recent access-management change targeting this user; null if never changed. */
  lastChange: { actor: string; action: string; ts: string } | null;
}

interface AggregatorOpts {
  /** Injectable clock (tests). Defaults to Date.now(). */
  now?: number;
  /** Injectable chat-stats fetcher (tests). Defaults to the HTTP client. */
  fetchChatStats?: typeof fetchChatStatsBySub;
}

function lastLoginFor(email: string): string | null {
  // One email can map to >1 users row (PK is the owner-sub: KC UUID in
  // real-auth, email in dev) — pick the most recent so a fresh dev row wins
  // over a stale real-auth leftover. Mirrors listUsers in access-store.
  const row = getDb()
    .prepare('SELECT last_login FROM users WHERE LOWER(email) = ? ORDER BY last_login DESC LIMIT 1')
    .get(normalizeEmail(email)) as { last_login: string | null } | undefined;
  return row?.last_login ?? null;
}

/**
 * Sum chat stats across the candidate owner-keys (KC sub + email). A user's
 * chat sessions can be keyed under either depending on the mode they ran in, so
 * the drill-in must aggregate both. Returns null only when chat-service was
 * unreachable (distinct from an empty {} = reachable, no usage).
 */
function mergeChatStats(byKey: ChatStatsBySub, keys: string[]): ChatUserStats | null {
  if (byKey === null) return null;
  const present = keys.map((k) => byKey[k]).filter((s): s is ChatUserStats => !!s);
  if (present.length === 0) return null;
  const merged: ChatUserStats = {
    turns: 0,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    by_skill: {},
  };
  for (const s of present) {
    merged.turns += s.turns;
    merged.input_tokens += s.input_tokens;
    merged.output_tokens += s.output_tokens;
    merged.cost_usd += s.cost_usd;
    for (const [skill, v] of Object.entries(s.by_skill ?? {})) {
      const acc = (merged.by_skill[skill] ??= { turns: 0, input_tokens: 0, output_tokens: 0 });
      acc.turns += v.turns;
      acc.input_tokens += v.input_tokens;
      acc.output_tokens += v.output_tokens;
    }
  }
  return merged;
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

  // Telemetry, segments and chat all key on the owner-sub, which is the KC UUID
  // in real-auth but the email in dev. Read across BOTH so a dev (email-keyed)
  // user's activity isn't invisible behind a UUID-only lookup. In prod the
  // email term matches nothing (a UUID never equals an email) → no-op there.
  const subs = ownerSubsForEmail(email, sub);

  const segmentCount =
    subs.length > 0
      ? (db
          .prepare(
            `SELECT COUNT(*) AS n FROM segments WHERE owner IN (${subs.map(() => '?').join(', ')})`,
          )
          .get(...subs) as { n: number }).n
      : 0;

  // Match by sub OR denormalised email: a person's events can be keyed under
  // several subs (dev sub, pre/post auth-migration UUIDs), and the single frozen
  // user_access.kc_sub a sub-only read resolves to misses the rest.
  const recentFeatures = queryActivity(db, {
    actorSubs: subs,
    actorEmail: email,
    eventType: 'feature_open',
    limit: 10,
  })
    .map((r) => r.targetId)
    .filter((t): t is string => !!t);

  const recentQueryShapes = queryActivity(db, {
    actorSubs: subs,
    actorEmail: email,
    eventType: 'query_run',
    limit: 10,
  })
    .map((r) => parseQueryShape(r.detailJson))
    .filter((s): s is ReturnType<typeof projectQueryShape> => s !== null);

  // Chat stats across both owner-keys; unknown → null (not a silent zero).
  const chat = subs.length > 0 ? await fetchStats(subs, { fromMs: now - 30 * DAY_MS, toMs: now }) : null;
  const chatStats = mergeChatStats(chat, subs);

  const audit = latestAuditForTarget(email);
  const lastChange = audit
    ? { actor: audit.actorEmail, action: audit.action, ts: audit.ts }
    : null;

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
    lastChange,
  };
}
