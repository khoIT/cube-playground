/**
 * Core investigation state for the Advisor experiment-builder flow.
 *
 * Owns the mutable aspect list (the cards the manager triages), the active
 * stage index, and screen navigation. Exposes a stable `handlers` object so
 * AspectCard and AddAngle components don't need to hold callbacks from a
 * higher level.
 */

import { useState, useCallback, useMemo } from 'react';
import type { Aspect, GoalKey, AdvisorScreen, StageKey, BlueprintSlots } from './advisor-types';
import {
  STAGES,
  DEMO_ASPECTS_REVENUE,
  DEMO_ASPECTS_ENGAGEMENT,
  NEEDS_INFO_REGEX,
  CUSTOM_FINDING,
} from './advisor-stage-config';

let customIdCounter = 0;
const nextCustomId = () => `c${++customIdCounter}`;

function slotFromQuestion(q: string): string {
  const s = q.trim().replace(/[?.!]+$/, '').toLowerCase();
  return s.length <= 30 ? s : `${s.slice(0, 28)}…`;
}

/** Compute blueprint slots from the current aspect list. */
export function computeBlueprintSlots(aspects: Aspect[]): BlueprintSlots {
  const result = {} as BlueprintSlots;
  for (const stage of STAGES) {
    const kept = aspects.filter((a) => a.stage === stage.key && a.triage === 'keep');
    const withSlot = kept.find((a) => a.slot);
    result[stage.key] = {
      text: withSlot?.slot ?? null,
      kept: kept.length,
      firstKeptId: kept[0]?.id ?? null,
    };
  }
  return result;
}

export interface InvestigationHandlers {
  onWork: (id: string) => void;
  onTriage: (id: string, verdict: Aspect['triage']) => void;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onRefine: (id: string) => void;
  onCancelEdit: (id: string) => void;
  onResubmit: (id: string, stageKey: StageKey, q: string) => void;
  onProvideInfo: (id: string, stageKey: StageKey, info: string) => void;
  onAdd: (stageKey: StageKey, q: string) => void;
  onAssert: (stageKey: StageKey, q: string) => void;
}

export interface InvestigationState {
  screen: AdvisorScreen;
  goal: GoalKey;
  goalText: string;
  aspects: Aspect[];
  activeStageIndex: number;
  openId: string | null;
  isBusy: boolean;
  split: number;
  blueprintSlots: BlueprintSlots;
  decideReady: boolean;

  // Navigation
  setScreen: (s: AdvisorScreen) => void;
  goStage: (i: number) => void;
  investigateCurrentStage: () => void;
  setOpenId: (id: string | null) => void;
  setSplit: (n: number) => void;

  // Setup (called from GoalScreen when the manager is done)
  setup: (goal: GoalKey, goalText: string) => void;

  handlers: InvestigationHandlers;
}

function simulateInvestigation(
  stageKey: StageKey,
  q: string,
): { state: 'needinfo'; need: string } | { state: 'done'; finding: string } {
  if (NEEDS_INFO_REGEX.test(q)) {
    return {
      state: 'needinfo',
      need: `I can't source this from the game data alone — it needs context only you have (a figure, the comparison set, or which market/server). Add the missing piece and I'll retry.`,
    };
  }
  return { state: 'done', finding: CUSTOM_FINDING[stageKey] ?? CUSTOM_FINDING.opportunity };
}

export function useAdvisorInvestigation(): InvestigationState {
  const [screen, setScreen] = useState<AdvisorScreen>('goal');
  const [goal, setGoal] = useState<GoalKey>('revenue');
  const [goalText, setGoalText] = useState('');
  const [aspects, setAspects] = useState<Aspect[]>([]);
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  // Treatment/hold-out split: 80% treatment / 20% hold-out by default.
  // Slider is clamped 70–85 so hold-out is always ≥15%.
  const [split, setSplit] = useState(80);

  const patchAspect = useCallback((id: string, patch: Partial<Aspect>) => {
    setAspects((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const setup = useCallback((g: GoalKey, text: string) => {
    setGoal(g);
    setGoalText(text);
    const base = g === 'revenue' ? DEMO_ASPECTS_REVENUE : DEMO_ASPECTS_ENGAGEMENT;
    setAspects(base.map((a) => ({ ...a, state: 'idle', triage: null, on: true })));
    setActiveStageIndex(0);
    setScreen('board');
  }, []);

  const goStage = useCallback((i: number) => {
    if (i >= STAGES.length) {
      setScreen('decide');
      return;
    }
    setActiveStageIndex(Math.max(0, i));
    setScreen('board');
  }, []);

  const investigateCurrentStage = useCallback(() => {
    setAspects((prev) => {
      const stageName = STAGES[activeStageIndex]?.key;
      if (!stageName) return prev;
      const todo = prev.filter(
        (a) => a.stage === stageName && a.on && a.state === 'idle',
      );
      if (!todo.length) return prev;
      setIsBusy(true);
      todo.forEach((a, idx) => {
        setTimeout(() => {
          setAspects((cur) =>
            cur.map((x) => (x.id === a.id ? { ...x, state: 'working' } : x)),
          );
        }, idx * 110);
        setTimeout(() => {
          setAspects((cur) =>
            cur.map((x) => (x.id === a.id ? { ...x, state: 'done' } : x)),
          );
          if (idx === todo.length - 1) setIsBusy(false);
        }, idx * 110 + 700);
      });
      return prev;
    });
  }, [activeStageIndex]);

  const handlers: InvestigationHandlers = useMemo(
    () => ({
      onWork: (id) => {
        patchAspect(id, { state: 'working' });
        setTimeout(() => patchAspect(id, { state: 'done' }), 700);
      },
      onTriage: (id, verdict) => patchAspect(id, { triage: verdict }),
      onToggle: (id) =>
        setAspects((prev) =>
          prev.map((a) => (a.id === id ? { ...a, on: !a.on } : a)),
        ),
      onOpen: (id) => setOpenId(id),
      onRefine: (id) => patchAspect(id, { state: 'editing' }),
      onCancelEdit: (id) => patchAspect(id, { state: 'done' }),
      onResubmit: (id, stageKey, q) => {
        patchAspect(id, { q, slot: slotFromQuestion(q), state: 'working', triage: null, finding: '', need: '' });
        setTimeout(() => {
          const result = simulateInvestigation(stageKey, q);
          if (result.state === 'needinfo') {
            patchAspect(id, { state: 'needinfo', need: result.need });
          } else {
            patchAspect(id, { state: 'done', finding: result.finding });
          }
        }, 900);
      },
      onProvideInfo: (id, stageKey, info) => {
        patchAspect(id, { state: 'working' });
        setTimeout(() => {
          patchAspect(id, {
            state: 'done',
            finding: `${CUSTOM_FINDING[stageKey]} (using what you added: "${info}").`,
            conf: 'med',
          });
        }, 900);
      },
      onAdd: (stageKey, q) => {
        const id = nextCustomId();
        setAspects((prev) => [
          ...prev,
          {
            id,
            stage: stageKey,
            q,
            finding: '',
            slot: slotFromQuestion(q),
            conf: 'med',
            custom: true,
            state: 'working',
            triage: null,
            on: true,
          },
        ]);
        setTimeout(() => {
          const result = simulateInvestigation(stageKey, q);
          if (result.state === 'needinfo') {
            patchAspect(id, { state: 'needinfo', need: result.need });
          } else {
            patchAspect(id, { state: 'done', finding: result.finding });
          }
        }, 900);
      },
      onAssert: (stageKey, q) => {
        const id = nextCustomId();
        setAspects((prev) => [
          ...prev,
          {
            id,
            stage: stageKey,
            q,
            finding:
              'Your assumption — kept so the experiment can move; not yet confirmed in data. The Command Center will flag it as assumed.',
            slot: slotFromQuestion(q),
            conf: 'med',
            custom: true,
            asserted: true,
            state: 'done',
            triage: 'keep',
            on: true,
          },
        ]);
      },
    }),
    [patchAspect],
  );

  const blueprintSlots = useMemo(() => computeBlueprintSlots(aspects), [aspects]);

  // Decide is "ready" when at least 4 of 5 blueprint slots are filled — a near-complete
  // investigation. Grade (Strong/Exploratory) is shown on the Decide screen.
  const decideReady =
    aspects.length > 0 &&
    STAGES.filter((s) => blueprintSlots[s.key]?.text).length >= 4;

  return {
    screen,
    goal,
    goalText,
    aspects,
    activeStageIndex,
    openId,
    isBusy,
    split,
    blueprintSlots,
    decideReady,
    setScreen,
    goStage,
    investigateCurrentStage,
    setOpenId,
    setSplit,
    setup,
    handlers,
  };
}
