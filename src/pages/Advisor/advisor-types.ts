/**
 * Local UI state types for the Advisor investigation flow.
 *
 * These mirror the experiment-anatomy model: each "aspect" is one angle the
 * advisor can investigate within a stage. The AspectCard manages a per-aspect
 * lifecycle (idle → working → done, or needinfo / editing for refinement) and
 * a triage verdict (keep / flag / dismiss / null).
 */

export type TriageVerdict = 'keep' | 'flag' | 'dismiss' | null;
export type AspectState = 'idle' | 'working' | 'done' | 'editing' | 'needinfo';

/** One investigatable angle within a stage. */
export interface Aspect {
  id: string;
  stage: StageKey;
  /** The guiding question for this angle. */
  q: string;
  /** The finding returned after investigation. */
  finding: string;
  /** Short phrase that fills the blueprint slot when this aspect is kept. */
  slot: string;
  /** 'high' | 'med' — maps to the confidence label + pill style. */
  conf: 'high' | 'med';
  /** For lever aspects: feasibility status. */
  feas?: 'true' | 'partial' | 'false';
  /** Why a lever is not yet feasible. */
  why?: string;
  /** Nearest feasible substitute when lever is not fully feasible. */
  sub?: string;
  /** Source basis note for proof aspects (e.g. "based on 1 test"). */
  basis?: string;
  /** Whether the manager is currently showing this angle. */
  on: boolean;
  state: AspectState;
  triage: TriageVerdict;
  /** True if added by the manager (custom angle). */
  custom?: boolean;
  /** True if the manager asserted this without data backing. */
  asserted?: boolean;
  /** When in needinfo state: what the advisor needs from the manager. */
  need?: string;
}

/** The five experiment-anatomy stages. */
export type StageKey = 'opportunity' | 'target' | 'cause' | 'lever' | 'proof';

export interface Stage {
  key: StageKey;
  label: string;
  emoji: string;
  /** Guiding question for this stage. */
  q: string;
  /** What this stage contributes to the final experiment. */
  builds: string;
  /** Description of what a strong answer looks like. */
  good: string;
  /** Short placeholder when the blueprint slot is empty. */
  slotEmpty: string;
}

/** Computed blueprint slots — one per stage. */
export type BlueprintSlots = Record<
  StageKey,
  { text: string | null; kept: number; firstKeptId: string | null }
>;

/** Which screen the advisor shell is showing. */
export type AdvisorScreen = 'goal' | 'board' | 'decide' | 'command' | 'drive';

/** The goal the manager selected. */
export type GoalKey = 'revenue' | 'engagement';

export interface GoalTemplate {
  label: string;
  tagline: string;
  sentence: string[];
}
