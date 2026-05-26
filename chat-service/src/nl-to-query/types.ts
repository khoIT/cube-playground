/**
 * Public shapes returned by the disambiguation engine. Kept in their own
 * module so callers (tools, tests, the orchestrator) can import them
 * without pulling in the implementation files.
 */

import type { CubeQuery } from '../types.js';

export type EngineLanguage = 'vi' | 'en' | 'mixed';
export type ChatDisambiguationMode = 'targeted' | 'aggressive';
export type EngineAction = 'auto' | 'clarify';

/**
 * Shape of the user's intent. The composer uses this to decide whether to
 * emit a leaderboard query (order + limit + entity dim), a trend (time
 * dimension granularity), a comparison (split-by-comparison member), or
 * the default aggregate (single number / breakdown by dim).
 */
export type QueryIntent = 'aggregate' | 'leaderboard' | 'trend' | 'comparison';

/** Confidence score in [0,1] attached to every slot the engine fills. */
export interface ScoredSlot<V> {
  value?: V;
  alias?: string;
  span?: [number, number];
  confidence: number;
}

export interface SlotFilter {
  member: string;
  operator: string;
  values: string[];
  confidence: number;
  alias?: string;
}

export interface DisambiguationSlots {
  metric: ScoredSlot<string>;
  dimension?: ScoredSlot<string>;
  timeRange?: ScoredSlot<string | [string, string]> & { granularity?: string };
  filters?: SlotFilter[];
  comparison?: ScoredSlot<string>;
  /**
   * Shape of the user's intent — derived per-turn from phrase patterns, not
   * persisted across turns. Drives whether the composer adds order+limit
   * (leaderboard), granularity (trend), comparison splits, or just an
   * aggregate measure.
   */
  intent: ScoredSlot<QueryIntent>;
  /**
   * Parsed limit hint (from phrases like "top 5") — propagated to the
   * composer when intent='leaderboard'. Optional; defaults to 10.
   */
  limit?: number;
  /**
   * Phase 02a — concept id resolved on this turn (`spender`, `whale`, …).
   * Memory carries it forward so a follow-up reply ("Revenue") inherits the
   * concept and the leaderboard-path can re-fire without re-asking.
   */
  concept?: ScoredSlot<string>;
  /** Phase 02a — entity (cube + primary key) derived from the resolved concept. */
  entity?: ScoredSlot<{ cube: string; pk: string }>;
}

export interface ClarificationOption {
  value: string;
  label_en: string;
  label_vi: string;
}

export interface Clarification {
  slot: 'metric' | 'dimension' | 'timeRange' | 'filters' | 'comparison';
  question_en: string;
  question_vi: string;
  options?: ClarificationOption[];
}

export interface DisambiguationResult {
  query: Partial<CubeQuery>;
  slots: DisambiguationSlots;
  unresolved: string[];
  clarifications: Clarification[];
  overallConfidence: number;
  language: EngineLanguage;
  action: EngineAction;
  warnings: string[];
}

/** A canonical glossary entry as seen by the engine — only Official rows. */
export interface OfficialTerm {
  id: string;
  label: string;
  description: string;
  primaryCatalogId: string | null;
  aliases: string[];
  aliasesVi: string[];
  labelVi: string | null;
  category: string | null;
  // Phase 02a concept-tier fields. Non-concept terms carry nulls; resolver
  // treats `entity_cube != null` as the "rankable concept" signal.
  entityCube?: string | null;
  entityPk?: string | null;
  defaultMeasureRef?: string | null;
  defaultFilter?: ConceptFilter | null;
  ranking?: ConceptRanking | null;
  trustTier?: 'certified' | 'experimental' | null;
}

/** Single inline filter carried by a concept term ("spender → revenue > 0"). */
export interface ConceptFilter {
  member: string;
  op: '>' | '>=' | '<' | '<=' | '=' | '!=' | 'IN' | 'NOT IN';
  value: string | number | Array<string | number>;
}

/** Ranking config for rankable concepts. */
export interface ConceptRanking {
  order: 'ASC' | 'DESC';
  default_limit: number;
}

/** Compiled alias index built from the Official glossary. */
export interface AliasEntry {
  alias: string;
  termId: string;
  cubeRef: string | null;
  lang: 'en' | 'vi';
}

export interface DisambiguateInput {
  message: string;
  mode: ChatDisambiguationMode;
  /** Optional cube /meta member names; if absent, ref validation is skipped. */
  knownMembers?: Set<string>;
}

export interface DisambiguateContext {
  now: () => number;
  fetchOfficialGlossary: () => Promise<OfficialTerm[]>;
}
