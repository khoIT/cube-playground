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

import React, { useState, useEffect } from 'react';
import { useParams, useHistory, useLocation } from 'react-router-dom';
import { Lightbulb } from 'lucide-react';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useAdvisorInvestigation } from './use-advisor-investigation';
import { STAGES } from './advisor-stage-config';
import { GoalScreen } from './goal-screen';
import { StepNav } from './step-nav';
import { StagePanel } from './stage-panel';
import { Blueprint } from './blueprint';
import { DecideScreen } from './decide-screen';
import { DecideDriveView } from './decide-drive-view';
import { CommandCenter } from './command-center';
import { Recommendations } from './recommendations';
import { ProvenanceDrawer } from './provenance-drawer';
import { ExperimentGatePrompt } from './experiment-gate-prompt';
import { experimentGateStatus } from './experiment-gate';
import { DrivePanel } from './drive-panel';
import { DriveSegmentPicker } from './drive-segment-picker';
import { RunHistoryPanel } from './run-history-panel';
import { RunReplay } from './run-replay';
import { Divider, Btn } from './advisor-primitives';
import type { DriveArtifact } from './drive-artifact';
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

  const history = useHistory();
  const location = useLocation<{ driveBoot?: boolean; driveSeed?: string } | undefined>();

  const inv = useAdvisorInvestigation();
  const [draft, setDraft] = useState<ExperimentDraft | null>(null);
  // The Drive (live AI) hand-off artifact, when a finished investigation is
  // carried into Decide. Cleared when leaving the Drive→Decide convergence.
  const [driveArtifact, setDriveArtifact] = useState<DriveArtifact | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The goal text from a game-scope drive, carried into the re-scoped segment drive.
  const [pendingSeed, setPendingSeed] = useState('');
  // Run-history surface: a selected run opens a read-only replay; the reload key
  // bumps when a live run finishes so the history list picks it up.
  const [replaySessionId, setReplaySessionId] = useState<string | null>(null);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  // A draft blocked by the quality gate, awaiting a typed override before it can
  // advance to the Command Center (manual Explore path; the Drive view collects
  // its own override inline).
  const [gateDraft, setGateDraft] = useState<ExperimentDraft | null>(null);

  // Boot straight into Drive when re-scoped here from a game-scope segment pick.
  const driveBoot = location.state?.driveBoot === true;
  const driveSeed = location.state?.driveSeed;
  useEffect(() => {
    if (driveBoot && inv.screen !== 'drive') inv.setScreen('drive');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveBoot]);

  const openAspect = inv.openId
    ? inv.aspects.find((a) => a.id === inv.openId) ?? null
    : null;

  function proceedToCommand(d: ExperimentDraft) {
    setGateDraft(null);
    setDraft(d);
    inv.setScreen('command');
  }

  // Single choke point into the Command Center for BOTH postures. Hard-stop a
  // draft that fails a critical quality dimension unless it carries a reasoned
  // override (the Drive view stamps one inline; the manual path collects one via
  // the gate prompt). This guarantees the gate can't be bypassed by entry path.
  function handleHandoff(d: ExperimentDraft) {
    if (experimentGateStatus(d.scorecard).blocked && !d.gateOverride) {
      setGateDraft(d);
      return;
    }
    proceedToCommand(d);
  }

  // Drive completion → converge into Decide with the agent's artifact.
  function handleDriveContinue(artifact: DriveArtifact) {
    setDriveArtifact(artifact);
    inv.setScreen('decide');
  }

  // Game-scope drive → a segment is set (created from the proposal OR picked),
  // then re-scope the investigation to it. Seed the scoped run to BUILD +
  // SCAFFOLD a draft (not just narrate), so the panel auto-advances to a
  // "Continue to Decide" instead of dead-ending.
  function reScopeToSegment(segmentId: string, seedBase: string) {
    setPickerOpen(false);
    const base = seedBase.trim();
    const driveSeed = `${base ? `${base}\n\n` : ''}Now scoped to this segment — build the experiment and scaffold the editable draft for it.`;
    history.push(`/advisor/${segmentId}`, { driveBoot: true, driveSeed });
  }

  // The Command Center screen owns its own full-bleed layout (lifecycle stepper
  // + monitoring), so it renders outside the standard page wrapper.
  if (inv.screen === 'command') {
    // `?illustrative=1` forces the demo bars (no-Cube hosts / walkthroughs);
    // otherwise a real segment scope drives the live treatment-vs-hold-out
    // scorecard. With HashRouter the query lives in location.search.
    const forceIllustrative =
      new URLSearchParams(location.search).get('illustrative') === '1';
    return (
      <CommandCenter
        goal={inv.goal}
        aspects={inv.aspects}
        goalText={inv.goalText}
        blueprintSlots={inv.blueprintSlots}
        split={inv.split}
        draft={draft}
        gameId={gameId}
        segmentId={segmentId}
        forceIllustrative={forceIllustrative}
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
            // Keying by scope forces a fresh mount on re-scope — which resets
            // DrivePanel's one-shot auto-run guard. Don't drop this key, or the
            // re-scoped investigation won't auto-start.
            key={scope.kind === 'segment' ? scope.segmentId : 'game'}
            scope={scope}
            goal={inv.goal}
            goalText={inv.goalText}
            seedMessage={driveBoot ? driveSeed : undefined}
            onSessionComplete={() => setHistoryReloadKey((k) => k + 1)}
            onContinue={handleDriveContinue}
            onPickSegment={(message) => {
              setPickerOpen(true);
              setPendingSeed(message);
            }}
            onCohortCreated={(segmentId, message) => reScopeToSegment(segmentId, message)}
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

      {/* Decide is the shared convergence: a Drive artifact renders the agent's
          experiment; otherwise the manual builder's blueprint + recommendations. */}
      {inv.screen === 'decide' && driveArtifact && (
        <DecideDriveView
          artifact={driveArtifact}
          onBack={() => {
            setDriveArtifact(null);
            inv.setScreen('drive');
          }}
          onHandoff={handleHandoff}
        />
      )}

      {inv.screen === 'decide' && !driveArtifact && (
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

      {pickerOpen && (
        <DriveSegmentPicker
          gameId={gameId}
          onClose={() => setPickerOpen(false)}
          onPick={(segmentId) => reScopeToSegment(segmentId, pendingSeed)}
        />
      )}

      {gateDraft && (
        <ExperimentGatePrompt
          scorecard={gateDraft.scorecard}
          onCancel={() => setGateDraft(null)}
          onProceed={(reason) =>
            proceedToCommand({ ...gateDraft, gateOverride: { reason, at: new Date().toISOString() } })
          }
        />
      )}
    </div>
  );
}

export default AdvisorPage;
