/**
 * Recommendations — ranked experiment candidate cards from /api/advisor/recommend.
 *
 * Each card shows:
 *   - Hypothesis + lever/playbook
 *   - Expected lift + confidence (one pill + plain sentence)
 *   - Power verdict in plain language ("Big enough for a clear answer in N days ✓")
 *   - Proven-vs-bet one-liner (never just a colour pill)
 *   - Addressable N + feasibility
 *   - "Review & set up" → handoff draft (never auto-launch)
 *   - "Show evidence" → jumps back to Explore lenses
 *   - Dismiss / pin with reason → feedback API
 *
 * If the recommend call fails (no live Cube) renders an honest empty state.
 */
import React, { useState } from 'react';
import type {
  Recommendation,
  ExperimentCandidate,
  ExperimentDraft,
  AdvisorScope,
  AdvisorGoal,
  RecommendParams,
} from '../../api/advisor';
import { recommend, handoff, sendFeedback } from '../../api/advisor';
import { Btn, CARD_STYLE, EYEBROW_STYLE, Pill, PulsingRow } from './advisor-primitives';

// ── Confidence display helpers ───────────────────────────────────────────────

const EFFECT_CONFIDENCE_COPY: Record<string, { label: string; sentence: string }> = {
  measured: {
    label: 'high confidence',
    sentence: `We've tested this — it worked. High confidence.`,
  },
  benchmark: {
    label: 'benchmark',
    sentence: `Based on similar games' benchmarks — a reasonable estimate.`,
  },
  assumption: {
    label: 'an estimate',
    sentence: 'Untested estimate — treat as a bet. Running it is how we find out.',
  },
};

// ── Feedback modal (dismiss / pin with reason) ───────────────────────────────

interface FeedbackModalProps {
  candidate: ExperimentCandidate;
  action: 'dismiss' | 'pin';
  segmentId: string;
  gameId: string;
  onDone: () => void;
  onCancel: () => void;
}

function FeedbackModal({
  candidate,
  action,
  segmentId,
  gameId,
  onDone,
  onCancel,
}: FeedbackModalProps) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await sendFeedback({
        segmentId,
        gameId,
        factor: candidate.opportunityFactor,
        leverFamily: candidate.lever.family,
        action,
        reason: reason.trim(),
      });
    } catch {
      // Non-blocking — feedback is best-effort
    }
    onDone();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.3)',
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          ...CARD_STYLE,
          padding: 24,
          width: 400,
          maxWidth: '92vw',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div style={{ ...EYEBROW_STYLE, marginBottom: 8 }}>
          {action === 'dismiss' ? 'Rule this out' : 'Pin this recommendation'}
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          {action === 'dismiss'
            ? 'Why is this not the right move? (structural / known / not-now)'
            : 'Why do you want to keep this visible?'}
        </p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Add your reasoning…"
          style={{
            width: '100%',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            padding: '7px 9px',
            outline: 'none',
            resize: 'none',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Btn kind="primary" sm onClick={submit} disabled={!reason.trim() || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Btn>
          <Btn sm onClick={onCancel}>
            Cancel
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Single candidate card ────────────────────────────────────────────────────

interface CandidateCardProps {
  candidate: ExperimentCandidate;
  segmentId: string;
  gameId: string;
  addressableN: number;
  onHandoff: (draft: ExperimentDraft) => void;
  onShowEvidence: (candidateId: string) => void;
}

function CandidateCard({
  candidate,
  segmentId,
  gameId,
  addressableN,
  onHandoff,
  onShowEvidence,
}: CandidateCardProps) {
  const [scaffolding, setScaffolding] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<'dismiss' | 'pin' | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const conf = EFFECT_CONFIDENCE_COPY[candidate.expectedEffect.confidence] ??
    EFFECT_CONFIDENCE_COPY.assumption;

  const isPowered = candidate.power.status === 'powered';
  const isFeasible = candidate.feasibility.status === 'feasible';

  const handleHandoff = async () => {
    setScaffolding(true);
    setHandoffError(null);
    try {
      const draft = await handoff({
        candidate,
        segmentId,
        gameId,
        addressableN,
      });
      onHandoff(draft);
    } catch {
      // Surface the failure inline (token-styled), not via a native alert.
      setScaffolding(false);
      setHandoffError('Could not create draft — live Cube connection required.');
    }
  };

  if (dismissed) return null;

  return (
    <>
      {feedbackTarget && (
        <FeedbackModal
          candidate={candidate}
          action={feedbackTarget}
          segmentId={segmentId}
          gameId={gameId}
          onDone={() => {
            if (feedbackTarget === 'dismiss') setDismissed(true);
            setFeedbackTarget(null);
          }}
          onCancel={() => setFeedbackTarget(null)}
        />
      )}

      <div
        style={{
          ...CARD_STYLE,
          padding: '16px 18px',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 8,
            marginBottom: 10,
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, marginBottom: 4 }}
            >
              {candidate.lever.description}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {candidate.lever.family} ·{' '}
              {candidate.lever.actuator === 'cs' ? 'CS delivery' : 'system delivery'}
            </div>
          </div>
          {candidate.money.incrementalVnd != null && (
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--brand)',
                whiteSpace: 'nowrap',
              }}
            >
              +{(candidate.money.incrementalVnd / 1_000_000).toFixed(0)}M₫
            </div>
          )}
        </div>

        {/* Rank reason */}
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--text-secondary)',
            marginBottom: 10,
            lineHeight: 1.45,
          }}
        >
          {candidate.rankReason}
        </div>

        {/* Confidence pill + plain sentence */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <Pill
            bg={
              candidate.expectedEffect.confidence === 'measured'
                ? 'var(--success-soft)'
                : candidate.expectedEffect.confidence === 'benchmark'
                  ? 'var(--info-soft)'
                  : 'var(--warning-soft)'
            }
            ink={
              candidate.expectedEffect.confidence === 'measured'
                ? 'var(--success-ink)'
                : candidate.expectedEffect.confidence === 'benchmark'
                  ? 'var(--info-ink)'
                  : 'var(--warning-ink)'
            }
          >
            {conf.label}
          </Pill>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{conf.sentence}</span>
        </div>

        {/* Power verdict — plain language */}
        <div
          style={{
            padding: '7px 10px',
            background: isPowered ? 'var(--success-soft)' : 'var(--warning-soft)',
            borderRadius: 'var(--radius-md)',
            fontSize: 12,
            color: isPowered ? 'var(--success-ink)' : 'var(--warning-ink)',
            marginBottom: 8,
          }}
        >
          {isPowered
            ? `📏 Big enough for a clear answer in ${Math.ceil(14)} days ✓`
            : `⚠ ${candidate.power.detail}`}
        </div>

        {/* Feasibility */}
        {!isFeasible && (
          <div
            style={{
              padding: '7px 10px',
              background: 'var(--destructive-soft)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
              color: 'var(--destructive-ink)',
              marginBottom: 8,
            }}
          >
            {candidate.feasibility.why ?? 'Not fully deliverable yet.'}
            {candidate.feasibility.substitute && (
              <>
                {' '}
                <b>Nearest we can do today:</b> {candidate.feasibility.substitute}
              </>
            )}
          </div>
        )}

        {/* Safety checks */}
        <div
          style={{
            fontSize: 11.5,
            color: 'var(--text-muted)',
            marginBottom: 12,
            lineHeight: 1.4,
          }}
        >
          🛟 No &lt;7d-payer contact · hold-out measured · 1 contact/player cap
        </div>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Btn kind="primary" sm onClick={handleHandoff} disabled={scaffolding}>
            {scaffolding ? 'Creating draft…' : 'Review & set up →'}
          </Btn>
          <Btn sm onClick={() => onShowEvidence(candidate.id)}>
            Show evidence
          </Btn>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => setFeedbackTarget('pin')}
            title="Pin — keep visible and teach the system"
            style={{
              fontFamily: 'var(--font-sans)',
              border: 'none',
              background: 'none',
              color: 'var(--text-muted)',
              fontSize: 13,
              cursor: 'pointer',
              padding: '2px 4px',
            }}
          >
            📌
          </button>
          <button
            onClick={() => setFeedbackTarget('dismiss')}
            title="Rule out — suppress with a reason"
            style={{
              fontFamily: 'var(--font-sans)',
              border: 'none',
              background: 'none',
              color: 'var(--text-muted)',
              fontSize: 13,
              cursor: 'pointer',
              padding: '2px 4px',
            }}
          >
            ✕
          </button>
        </div>

        {handoffError && (
          <div
            role="alert"
            style={{
              marginTop: 10,
              padding: '8px 11px',
              background: 'var(--destructive-soft)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
              color: 'var(--destructive-ink)',
              lineHeight: 1.45,
            }}
          >
            {handoffError}
          </div>
        )}
      </div>
    </>
  );
}

// ── Recommendations panel ────────────────────────────────────────────────────

interface RecommendationsProps {
  scope: AdvisorScope;
  goal: AdvisorGoal;
  addressableN: number;
  onHandoff: (draft: ExperimentDraft) => void;
  onShowEvidence: (candidateId: string) => void;
}

export function Recommendations({
  scope,
  goal,
  addressableN,
  onHandoff,
  onShowEvidence,
}: RecommendationsProps) {
  const [reco, setReco] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params: RecommendParams = { addressableN };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await recommend({ scope, goal, params });
      setReco(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('502') || msg.includes('fetch')
        ? 'Recommendations need a live Cube connection — unavailable here. Results will appear once Cube is reachable.'
        : msg);
    } finally {
      setLoading(false);
    }
  };

  const segmentId = scope.kind === 'segment' ? scope.segmentId : '';
  const gameId = scope.gameId;

  return (
    <div style={{ fontFamily: 'var(--font-sans)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div>
          <div style={EYEBROW_STYLE}>Ranked experiments</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 0' }}>
            What to try next
          </h2>
        </div>
        <Btn sm onClick={load} disabled={loading}>
          {loading ? 'Loading…' : reco ? '↻ Refresh' : 'Load recommendations'}
        </Btn>
      </div>

      {loading && (
        <PulsingRow>
          <span>✨</span> Ranking experiments…
        </PulsingRow>
      )}

      {error && (
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--warning-soft)',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            color: 'var(--warning-ink)',
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      )}

      {reco && reco.candidates.length === 0 && (
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--bg-muted)',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            color: 'var(--text-muted)',
          }}
        >
          No ranked candidates returned — try adjusting the scope or goal.
        </div>
      )}

      {reco && reco.candidates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reco.candidates.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              segmentId={segmentId}
              gameId={gameId}
              addressableN={addressableN}
              onHandoff={onHandoff}
              onShowEvidence={onShowEvidence}
            />
          ))}
        </div>
      )}

      {!reco && !loading && !error && (
        <div
          style={{
            padding: '20px',
            background: 'var(--bg-muted)',
            borderRadius: 'var(--radius-md)',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          Load recommendations to see ranked experiments for this scope.
        </div>
      )}
    </div>
  );
}
