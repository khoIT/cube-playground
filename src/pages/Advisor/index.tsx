/**
 * Optimization Advisor — the decision rail in front of the Experiment Command
 * Center. One spine, three postures: Explore (the 5-stage experiment builder),
 * Recommend (ranked candidate cards, live from /api/advisor/recommend), and
 * Drive (the reversible hand-off → an editable Command Center draft).
 *
 * Flow: Goal → Board (Opportunity·Target·Cause·Lever·Proof) → Decide → Command.
 * The builder stages are demo-driven (honest stage-aware placeholders, never
 * fabricated metrics); the Recommend cards + hand-off draft are live API calls.
 * On a host without Cube the live calls surface an honest error state.
 */

import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lightbulb } from 'lucide-react';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useAdvisorInvestigation } from './use-advisor-investigation';
import { STAGES } from './advisor-stage-config';
import { GoalScreen } from './goal-screen';
import { StepNav } from './step-nav';
import { StagePanel } from './stage-panel';
import { Blueprint } from './blueprint';
import { DecideScreen } from './decide-screen';
import { CommandCenter } from './command-center';
import { Recommendations } from './recommendations';
import { ProvenanceDrawer } from './provenance-drawer';
import { DrivePanel } from './drive-panel';
import { RunHistoryPanel } from './run-history-panel';
import { RunReplay } from './run-replay';
import { Divider, Btn } from './advisor-primitives';
import type { AdvisorScope, ExperimentDraft } from '../../api/advisor';

/**
 * Default addressable cohort size used to seed the live recommend params when
 * the real segment size is unknown on this host. The server validates N>0; a
 * live deployment passes the diagnosis N. Surfaced, not hidden.
 */
const DEFAULT_ADDRESSABLE_N = 2400;

const PAGE_STYLE: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1200,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
  color: 'var(--text-primary)',
};

export function AdvisorPage() {
  const params = useParams<{ id?: string }>();
  const activeGame = useActiveGameId();
  const gameId = activeGame ?? 'cfm_vn';
  const segmentId = params.id ?? null;

  const scope: AdvisorScope = segmentId
    ? { kind: 'segment', segmentId, gameId }
    : { kind: 'game', gameId };

  const inv = useAdvisorInvestigation();
  const [draft, setDraft] = useState<ExperimentDraft | null>(null);
  // Run-history surface: a selected run opens a read-only replay; the reload key
  // bumps when a live run finishes so the history list picks it up.
  const [replaySessionId, setReplaySessionId] = useState<string | null>(null);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);

  const openAspect = inv.openId
    ? inv.aspects.find((a) => a.id === inv.openId) ?? null
    : null;

  function handleHandoff(d: ExperimentDraft) {
    setDraft(d);
    inv.setScreen('command');
  }

  // The Command Center screen owns its own full-bleed layout (lifecycle stepper
  // + monitoring), so it renders outside the standard page wrapper.
  if (inv.screen === 'command') {
    return (
      <CommandCenter
        goal={inv.goal}
        aspects={inv.aspects}
        goalText={inv.goalText}
        blueprintSlots={inv.blueprintSlots}
        split={inv.split}
        draft={draft}
        onBackToAdvisor={() => inv.setScreen('decide')}
      />
    );
  }

  return (
    <div style={PAGE_STYLE}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Lightbulb size={22} color="var(--brand)" aria-hidden />
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: 'var(--font-sans)' }}>
          Optimization Advisor
        </h1>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          · {segmentId ? `segment ${segmentId.slice(0, 8)}…` : gameId}
        </span>
        {/* Posture toggle: Drive (live AI) is additive to the Explore builder. */}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {inv.screen === 'drive' ? (
            <Btn sm onClick={() => inv.setScreen('goal')}>
              ← Explore
            </Btn>
          ) : (
            <Btn sm kind="primary" onClick={() => inv.setScreen('drive')}>
              ✨ Drive with AI
            </Btn>
          )}
        </span>
      </header>

      {inv.screen === 'goal' && <GoalScreen onSetup={inv.setup} />}

      {inv.screen === 'drive' && (
        <>
          <DrivePanel
            scope={scope}
            goal={inv.goal}
            goalText={inv.goalText}
            onSessionComplete={() => setHistoryReloadKey((k) => k + 1)}
          />
          <RunHistoryPanel reloadKey={historyReloadKey} onOpen={setReplaySessionId} />
        </>
      )}

      {inv.screen === 'board' && (
        <>
          <StepNav
            goal={inv.goal}
            activeStageIndex={inv.activeStageIndex}
            slots={inv.blueprintSlots}
            onGoStage={inv.goStage}
            onDecide={() => inv.setScreen('decide')}
            decideReady={inv.decideReady}
          />
          <StagePanel
            stageIndex={inv.activeStageIndex}
            aspects={inv.aspects}
            handlers={inv.handlers}
            isBusy={inv.isBusy}
            onGoStage={inv.goStage}
            onInvestigateAll={inv.investigateCurrentStage}
          />
          <Divider />
          <Blueprint
            goal={inv.goal}
            slots={inv.blueprintSlots}
            onJump={(stageKey) => {
              const idx = STAGES.findIndex((s) => s.key === stageKey);
              if (idx >= 0) inv.goStage(idx);
            }}
          />
        </>
      )}

      {inv.screen === 'decide' && (
        <>
          <DecideScreen
            goal={inv.goal}
            aspects={inv.aspects}
            blueprintSlots={inv.blueprintSlots}
            split={inv.split}
            setSplit={inv.setSplit}
            onBack={() => inv.setScreen('board')}
            onGoStage={inv.goStage}
            onSend={() => inv.setScreen('command')}
            setOpenId={inv.setOpenId}
          />
          <Divider />
          <Recommendations
            scope={scope}
            goal={inv.goal}
            addressableN={DEFAULT_ADDRESSABLE_N}
            onHandoff={handleHandoff}
            onShowEvidence={inv.setOpenId}
          />
        </>
      )}

      <ProvenanceDrawer
        aspect={openAspect}
        onClose={() => inv.setOpenId(null)}
        onTriage={inv.handlers.onTriage}
      />

      {replaySessionId && (
        <RunReplay sessionId={replaySessionId} onClose={() => setReplaySessionId(null)} />
      )}
    </div>
  );
}

export default AdvisorPage;
