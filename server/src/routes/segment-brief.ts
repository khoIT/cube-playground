/**
 * AI segment brief route — GET /api/segments/:id/brief?lang=&refresh=1
 *
 * Serves the cached LLM executive narrative for a segment, regenerating only
 * when the cohort DEFINITION moved (definition hash mismatch) or the caller
 * explicitly refreshes. Generation never blocks segment GET — this is its own
 * endpoint the FE loads lazily.
 *
 *   cache hit  → instant return (no LLM call)
 *   miss/stale → single-flight per (segment, lang): assemble context →
 *                POST chat-service /internal/segment-brief → upsert → return
 *   LLM down   → previous ok brief (stale hash) served with stale:true;
 *                otherwise a persisted status='error' row + 502 (retryable)
 *
 * ?refresh=1 is rate-limited to one accepted regeneration per (segment, lang)
 * per 10 minutes — any workspace member can hit it, and an unthrottled loop
 * would burn the quota-capped LLM gateway key.
 */

import type { FastifyInstance } from 'fastify';
import { guardSegment } from './segments.js';
import { chatServiceUrl } from './chat.js';
import { segmentDefinitionHash } from '../services/segment-definition-hash.js';
import { assembleBriefContext, type BriefSegmentRowInput } from '../services/segment-brief-context.js';
import {
  getBriefCache,
  upsertBriefCache,
  singleFlightBrief,
  type BriefCacheRow,
} from '../services/segment-brief-store.js';

const CHAT_BRIEF_TIMEOUT_MS = 60_000;
const REFRESH_COOLDOWN_MS = 10 * 60_000;
/**
 * Backoff after a FAILED generation when a stale-but-ok brief exists. Without
 * it the stale-serve path never writes an error row (the stale brief wins),
 * so every plain GET would re-hit the quota-capped LLM gateway for the whole
 * duration of an upstream outage. Within the window, stale is served
 * immediately; ?refresh=1 still bypasses (subject to its own cooldown).
 */
const FAILURE_BACKOFF_MS = 2 * 60_000;

/** Persisted + served brief payload (the envelope stored in brief_json). */
interface BriefPayload {
  label: string;
  narrative: string;
  signals: string[];
  data_coverage: 'full' | 'limited';
  generated_at: string;
  member_count: number;
  definition_hash: string;
}

const lastRefreshAt = new Map<string, number>();
const lastFailureAt = new Map<string, number>();

/** Test hook — clears the refresh-cooldown + failure-backoff ledgers. */
export function __resetBriefRefreshState(): void {
  lastRefreshAt.clear();
  lastFailureAt.clear();
}

function briefResponse(row: BriefCacheRow, stale = false) {
  return {
    segment_id: row.segment_id,
    lang: row.lang,
    status: row.status,
    ...(stale ? { stale: true } : {}),
    brief: row.brief_json ? (JSON.parse(row.brief_json) as BriefPayload) : null,
    ...(row.error ? { error: row.error } : {}),
    generated_at: row.generated_at,
  };
}

/** One generation pass: context → chat-service → validated brief payload.
 *  Throws on transport/validation failure (caller maps to error row / stale). */
async function generateBrief(
  segment: BriefSegmentRowInput,
  lang: string,
  definitionHash: string,
): Promise<BriefPayload> {
  const secret = process.env.INTERNAL_SECRET ?? '';
  if (!secret) throw new Error('INTERNAL_SECRET not configured');

  const context = await assembleBriefContext(segment);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CHAT_BRIEF_TIMEOUT_MS);
  try {
    const res = await fetch(`${chatServiceUrl()}/internal/segment-brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ context, lang }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`chat-service responded ${res.status}`);
    const body = (await res.json()) as { label?: string; narrative?: string; signals?: string[] };
    if (!body.label || !body.narrative || !Array.isArray(body.signals)) {
      throw new Error('chat-service returned malformed brief');
    }
    return {
      label: body.label,
      narrative: body.narrative,
      signals: body.signals,
      data_coverage: context.data_coverage,
      generated_at: new Date().toISOString(),
      member_count: context.segment.member_count,
      definition_hash: definitionHash,
    };
  } finally {
    clearTimeout(timer);
  }
}

export default async function segmentBriefRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/segments/:id/brief', async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { lang?: string; refresh?: string };
    // Visibility guard runs BEFORE any cache read — an unshared segment must
    // 403/404 here, never leak a previously cached brief.
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;

    const lang = query.lang === 'vi' ? 'vi' : 'en';
    const wantsRefresh = query.refresh === '1' || query.refresh === 'true';

    const definitionHash = segmentDefinitionHash({
      type: row.type as string,
      cube: row.cube as string | null,
      game_id: row.game_id as string | null,
      predicate_tree_json: row.predicate_tree_json as string | null,
      uid_list_json: row.uid_list_json as string | null,
    });

    const cached = getBriefCache(id, lang);
    if (cached && cached.definition_hash === definitionHash && !wantsRefresh) {
      return briefResponse(cached);
    }

    // Failure backoff: a recent failed generation with a stale-but-ok brief on
    // file short-circuits to stale instead of re-burning the gateway quota.
    const flightKey = `${id}:${lang}`;
    if (!wantsRefresh && cached?.status === 'ok' && cached.brief_json) {
      const failedAt = lastFailureAt.get(flightKey);
      if (failedAt != null && Date.now() - failedAt < FAILURE_BACKOFF_MS) {
        return briefResponse(cached, true);
      }
    }

    if (wantsRefresh) {
      const last = lastRefreshAt.get(flightKey);
      if (last != null && Date.now() - last < REFRESH_COOLDOWN_MS) {
        return reply.status(429).send({
          error: {
            code: 'RATE_LIMITED',
            message: 'Brief was refreshed recently — try again later',
            retry_after_ms: REFRESH_COOLDOWN_MS - (Date.now() - last),
          },
        });
      }
      lastRefreshAt.set(flightKey, Date.now());
    }

    const segment: BriefSegmentRowInput = {
      id,
      name: row.name as string,
      type: row.type as string,
      cube: row.cube as string | null,
      game_id: row.game_id as string | null,
      workspace: row.workspace,
      uid_count: (row.uid_count as number) ?? 0,
      predicate_tree_json: row.predicate_tree_json as string | null,
      cube_query_json: row.cube_query_json as string | null,
      member_tiers_json: row.member_tiers_json as string | null | undefined,
    };

    try {
      // Refresh gets its own flight lane: joining an in-flight NORMAL
      // generation would return the non-refreshed result while still spending
      // the caller's 10-minute refresh slot.
      const payload = await singleFlightBrief(id, wantsRefresh ? `${lang}:refresh` : lang, async () => {
        // Re-check inside the flight: a concurrent request may have already
        // generated and cached this exact brief while we awaited the lock.
        const fresh = getBriefCache(id, lang);
        if (fresh && fresh.definition_hash === definitionHash && fresh.status === 'ok' && !wantsRefresh) {
          return JSON.parse(fresh.brief_json!) as BriefPayload;
        }
        const generated = await generateBrief(segment, lang, definitionHash);
        upsertBriefCache({
          segmentId: id,
          lang,
          definitionHash,
          briefJson: JSON.stringify(generated),
          status: 'ok',
        });
        return generated;
      });
      lastFailureAt.delete(flightKey); // healthy again — lift the backoff
      return {
        segment_id: id,
        lang,
        status: 'ok' as const,
        brief: payload,
        generated_at: payload.generated_at,
      };
    } catch (err) {
      lastFailureAt.set(flightKey, Date.now());
      const message = ((err as Error).message || 'brief generation failed').slice(0, 500);
      // A previous OK brief (even for the old definition) beats an error page —
      // serve it marked stale so the FE can show "outdated" instead of failing.
      if (cached && cached.status === 'ok' && cached.brief_json) {
        return briefResponse(cached, true);
      }
      upsertBriefCache({
        segmentId: id,
        lang,
        definitionHash,
        briefJson: null,
        status: 'error',
        error: message,
      });
      return reply.status(502).send({
        error: { code: 'BRIEF_GENERATION_FAILED', message },
      });
    }
  });
}
