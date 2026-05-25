/**
 * Public shapes returned by the disambiguation engine. Kept in their own
 * module so callers (tools, tests, the orchestrator) can import them
 * without pulling in the implementation files.
 */

import type { CubeQuery } from '../types.js';

export type EngineLanguage = 'vi' | 'en' | 'mixed';
export type ChatDisambiguationMode = 'targeted' | 'aggressive';
export type EngineAction = 'auto' | 'clarify';

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
