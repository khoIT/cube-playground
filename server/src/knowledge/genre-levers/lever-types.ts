/**
 * Types for the genre-aware lever knowledge library.
 *
 * A "lever" is an operator dial a game team can pull (e.g. "clan social
 * retention", "VIP-tier thresholds"). Each lever declares the signal that
 * triggers it, the cubes it needs to even be assessable (the data-gate),
 * the benchmark that says what "normal" looks like (both an internal
 * portfolio percentile and an external industry norm), and the recommended
 * action plus how a confirmed acceptance is written back.
 *
 * The library is the single source of truth for *what the chat may
 * recommend*. Downstream tools cite it; they never invent a lever.
 */

/** Genre slug. Open string union — new genres add a slug + a game→genre row. */
export type Genre = 'competitive-fps' | 'social-mmorpg' | (string & {});

/** How a confirmed recommendation is persisted (the write happens on explicit
 *  user confirm — never silently by the agent). 'none' = informational only. */
export type DefaultWrite = 'case' | 'sweep' | 'experiment' | 'none';

/** A hand-authored industry norm. `source` + `citation` are REQUIRED — the
 *  resolver drops any norm missing them so a number never appears un-sourced. */
export interface ExternalNorm {
  /** The reference value, e.g. 20 for "D7 retention ~20%". */
  value: number;
  /** Unit of `value`: '%', 'vnd', 'usd', 'ratio', 'days', 'count'. */
  unit: string;
  /** Which direction is healthy — disambiguates "below norm = bad". */
  direction?: 'higher-better' | 'lower-better';
  /** Publisher/owner of the figure (e.g. "GameAnalytics 2019 benchmarks"). */
  source: string;
  /** Free-text provenance / caveat. Drafted for human verification. */
  citation: string;
}

/** Which portfolio percentile band defines "normal" for this lever's metric. */
export type PercentileBand = 'p25' | 'p50' | 'p75' | 'p90';

export interface LeverBenchmark {
  /** Canonical metric key this lever watches; joins to the percentile snapshot. */
  metricKey: string;
  /** Band that represents "normal" for this lever (default p50 if omitted). */
  internalPercentileBand?: PercentileBand;
  /** Hand-authored external industry norm (optional; validated at resolve). */
  externalNorm?: ExternalNorm;
}

export interface LeverAction {
  /** Operator-facing recommendation text. */
  text: string;
  /** Care playbook ids this action maps to (references only — never copies). */
  mapsToPlaybookIds?: string[];
  /** Tie to advisor `lever-map.ts` LeverFamily.family for experiment routing. */
  leverFamily?: string;
}

export interface GenreLever {
  /** Stable kebab id, unique across the library. */
  id: string;
  /** Genres this lever belongs to. */
  genreTags: Genre[];
  /** Explicit game allowlist. EMPTY = applies to every game whose genre is in
   *  genreTags (a genre-wide lever); non-empty = pinned to those games only. */
  games: string[];
  /** Human-readable lever name. */
  lever: string;
  /** The measurable trigger ("clan members declining / clan_left rising"). */
  signal: string;
  /** Cube members that must exist for this lever to be assessable. A lever
   *  whose cubes are absent for a game is WITHHELD (never guessed). Empty +
   *  blindSpot=true means "structurally unmeasurable — surface, don't act". */
  requiredCubes: string[];
  benchmark: LeverBenchmark;
  action: LeverAction;
  defaultWrite: DefaultWrite;
  /** True => no data path exists; render as "cannot assess", never an action. */
  blindSpot?: boolean;
  /** The genre "why" behind the lever — used in narrative, not as an action. */
  rationale?: string;
}

// ── Resolved shapes returned by the route ────────────────────────────────────

export interface ResolvedInternalBand {
  band: PercentileBand;
  value: number;
  computedAt: string;
}

export interface ResolvedBenchmark {
  metricKey: string;
  external?: ExternalNorm;
  /** Null when no snapshot row exists yet (job hasn't run / metric untracked). */
  internal: ResolvedInternalBand | null;
}

export interface ResolvedLever extends Omit<GenreLever, 'benchmark'> {
  benchmark: ResolvedBenchmark;
}

export interface WithheldLever {
  id: string;
  lever: string;
  reason: string;
  missingCubes: string[];
}

export interface LeverResolution {
  game: string;
  genre: Genre | null;
  levers: ResolvedLever[];
  withheld: WithheldLever[];
  blindSpots: ResolvedLever[];
}
