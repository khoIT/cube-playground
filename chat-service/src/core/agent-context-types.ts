/**
 * Typed contracts for the two pushed-context capabilities the agent gains:
 *   - ModelGraphDigest — a compact per-game map of the data model (P1).
 *   - ResolvedContext  — what the session has already resolved (P2).
 *
 * Contracts only: no behavior. Producers live in `model-graph-digest.ts`
 * (P1) and `resolved-context.ts` (P2); both render to terse text injected
 * into the system prompt behind their respective feature flags.
 */

import type { QueryIntentSlot, TimeRangeValue } from '../cache/disambig-memory-adapter.js';

// ---------------------------------------------------------------------------
// ModelGraphDigest (P1) — derived from the cached /meta join topology.
// ---------------------------------------------------------------------------

/** A cube that joins N:1 into the hub (the "reaches the user" set). */
export interface DigestHubEdge {
  /** The cube on the many side of the N:1 join. */
  cube: string;
  /** Readable `localCol → hubCol` key label, e.g. `user_id → user_id`. */
  keyLabel: string;
}

/**
 * Compact, prompt-sized summary of a game's data model. Built from the same
 * join graph the FE Catalog renders, reduced to what an analyst agent needs
 * for triage: the user hub + its primary key, what joins to it, what clusters
 * exist, and what is isolated (no path to the user).
 */
export interface ModelGraphDigest {
  /** The user hub cube + its primary key, or null if no `mf_users`-like hub. */
  hub: { cube: string; pk: string } | null;
  /** Cubes that join N:1 directly into the hub. */
  hubInbound: DigestHubEdge[];
  /** Cluster key → member cube base names (visual/topical grouping). */
  clusters: Record<string, string[]>;
  /** Cubes with no join to any present cube — usually standalone marts. */
  isolated: string[];
  /** Count of non-view cubes considered (for the digest header). */
  cubeCount: number;
}

// ---------------------------------------------------------------------------
// ResolvedContext (P2) — projection of session disambiguation memory.
// ---------------------------------------------------------------------------

/** One resolved slot: the canonical value plus the user's phrasing/label. */
export interface ResolvedSlot<T> {
  value: T;
  /** The user's natural-language phrase that produced it, if known. */
  label?: string;
}

/**
 * What the session has already pinned. Sourced from `getResolutions` (the same
 * single store the deterministic engine writes), so the agent and the engine
 * never disagree about what is resolved. Absent fields are unresolved.
 */
export interface ResolvedContext {
  entity?: ResolvedSlot<{ cube: string; pk: string }>;
  metric?: ResolvedSlot<string>;
  timeRange?: ResolvedSlot<TimeRangeValue>;
  concept?: ResolvedSlot<string>;
  intent?: ResolvedSlot<QueryIntentSlot>;
  /** Epoch ms of the last write to memory (continuity/debug aid). */
  updatedAt?: number;
}
