/**
 * Live monitoring — the final step of the linear advisor→experiment flow: review
 * the experiment, then watch treatment vs hold-out as it runs. Reached after the
 * Decide screen hands off a scaffolded draft.
 *
 * Design stance:
 *   - status=draft until the manager explicitly freezes groups
 *   - Delivery is owner-run (CS calls / LiveOps / email); the in-system CS work
 *     queue is a later, per-experiment-customizable path and is intentionally not
 *     wired here yet
 *   - Outcome tracking reads billing — monitoring works regardless of delivery path
 *   - "Did it work?" leads the readout; UID match rate is framed as confirmed-reach
 *     coverage (not "tool lost track")
 *
 * In this build the ExperimentDraft from /api/advisor/handoff populates the sidebar
 * "At a glance" panel. If handoff hasn't completed yet (e.g. no live Cube) the
 * screen degrades gracefully showing the investigation-derived values instead.
 * Monitoring bars are illustrative (clearly labeled) until the real outcome-query
 * wiring lands.
 */
import React, { useEffect, useState } from 'react';
import type { Aspect, GoalKey, BlueprintSlots } from './advisor-types';
import type { ExperimentDraft } from '../../api/advisor';
import { STAGES } from './advisor-stage-config';
import { Blueprint } from './blueprint';
import { Btn, CARD_STYLE, EYEBROW_STYLE, MiniBars } from './advisor-primitives';
import { useExperimentMonitor } from './use-experiment-monitor';

// ── Lifecycle steps ──────────────────────────────────────────────────────────

const LIFECYCLE = [
  { key: 'draft', label: 'Draft', bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
  { key: 'frozen', label: 'Groups frozen', bg: 'var(--info-soft)', ink: 'var(--info-ink)' },
  { key: 'delivering', label: 'In delivery', bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
  { key: 'measuring', label: 'Measuring', bg: 'var(--info-soft)', ink: 'var(--info-ink)' },
  { key: 'readout', label: 'Readout', bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
] as const;

type LifecycleKey = typeof LIFECYCLE[number]['key'];

// ── Props ────────────────────────────────────────────────────────────────────

interface CommandCenterProps {
  goal: GoalKey;
  aspects: Aspect[];
  goalText: string;
  blueprintSlots: BlueprintSlots;
  split: number;
  draft: ExperimentDraft | null;
  /** Active game — needed to create the real experiment. */
  gameId: string;
  /** The cohort segment when the board is backed by a real experiment; null on
   *  the manual/demo path (then the board stays illustrative). */
  segmentId: string | null;
  /** URL `?illustrative=1` — force the demo bars regardless of scope. */
  forceIllustrative: boolean;
  onBackToAdvisor: () => void;
}

/** Format a VND amount compactly (e.g. 312_000_000 → "312M₫"). */
function fmtVnd(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B₫`;
  if (v >= 1e6) return `${Math.round(v / 1e6)}M₫`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K₫`;
  return `${Math.round(v)}₫`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function CommandCenter({
  goal,
  aspects,
  goalText,
  blueprintSlots,
  split,
  draft,
  gameId,
  segmentId,
  forceIllustrative,
  onBackToAdvisor,
}: CommandCenterProps) {
  const [lifecycleIdx, setLifecycleIdx] = useState(0);
  const [thesisOpen, setThesisOpen] = useState(true);

  const currentLifecycle = LIFECYCLE[lifecycleIdx];
  const isRevenue = goal === 'revenue';
  const lever = aspects.find((a) => a.stage === 'lever' && a.triage === 'keep');

  const title = `${lever?.q ?? 'Experiment'} · investigation`;

  // Real experiment lifecycle: create a draft from the segment, freeze on the
  // groups-freeze action, then fetch the real treatment-vs-hold-out scorecard.
  // Falls back to illustrative bars when there's no segment / `?illustrative=1`.
  const monitor = useExperimentMonitor({
    gameId,
    segmentId,
    draft,
    splitPct: draft?.arms.find((a) => a.key === 'treatment')?.share
      ? Math.round((draft.arms.find((a) => a.key === 'treatment')!.share as number) * 100)
      : split,
    primaryMetric: isRevenue ? 'gross_payment_rate' : 'sessions_per_week',
    experimentName: lever?.q ?? `${gameId} experiment`,
    forceIllustrative,
  });
  const sc = monitor.state.scorecard;
  const live = monitor.state.live && !!sc;

  // Load the real scorecard once the split is frozen.
  useEffect(() => {
    if (monitor.state.assignment && !monitor.state.scorecard) void monitor.loadScorecard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitor.state.assignment]);

  // Cohort sizes — real arm counts when live, else draft, else illustrative demo.
  const treatArm = sc?.arms.find((a) => a.arm === 'treatment');
  const ctrlArm = sc?.arms.find((a) => a.arm === 'control');
  const assignment = monitor.state.assignment;
  const reachableN = draft?.cohort.addressableN ?? 1872;
  const treatN = live
    ? (treatArm?.assigned ?? 0)
    : assignment
      ? assignment.treatment
      : draft
        ? Math.round(reachableN * ((draft.arms.find((a) => a.key === 'treatment')?.share ?? split / 100)))
        : Math.round(reachableN * (split / 100));
  const holdN = live
    ? (ctrlArm?.assigned ?? 0)
    : assignment
      ? assignment.control
      : reachableN - treatN;
  const windowDays = draft?.windowDays ?? 14;

  // Real readout values (live only) — re-pay rates per arm + roll-out projection.
  const treatRatePct = (sc?.scorecard.repayRate.treatmentRate ?? 0) * 100;
  const ctrlRatePct = (sc?.scorecard.repayRate.controlRate ?? 0) * 100;
  const liftPp = sc?.scorecard.repayRate.liftPp ?? 0;
  const verdict = sc?.scorecard.verdict ?? 'inconclusive';
  // Projected VND if the per-member gross lift were rolled out to the hold-out.
  const rolloutVnd = (sc?.scorecard.grossPerMember.liftAbs ?? 0) * holdN;
  const barMax = Math.max(4, Math.ceil(Math.max(treatRatePct, ctrlRatePct, 1) * 1.3));

  // Illustrative contact progress (only shown in delivering/measuring/readout)
  const contacted =
    currentLifecycle.key === 'delivering'
      ? Math.round(treatN * 0.42)
      : ['measuring', 'readout'].includes(currentLifecycle.key)
        ? Math.round(treatN * 0.96)
        : 0;

  // Advancing FROM draft freezes the real split first; only advance on success
  // (illustrative mode resolves true immediately, so the demo flow is unchanged).
  const advance = async () => {
    if (currentLifecycle.key === 'draft') {
      const ok = await monitor.freeze();
      if (!ok) return;
    }
    setLifecycleIdx((i) => Math.min(LIFECYCLE.length - 1, i + 1));
  };

  const ctaLabel: Record<LifecycleKey, string | null> = {
    draft: 'Confirm & freeze the groups →',
    frozen: 'Mark delivery started →',
    delivering: 'Mark delivery complete →',
    measuring: 'View readout →',
    readout: null,
  };

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', fontFamily: 'var(--font-sans)' }}>
      {/* Sub-header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 14,
        }}
      >
        <div>
          <div style={EYEBROW_STYLE}>📡 Live monitoring · Experiment</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '5px 0 0', lineHeight: 1.2 }}>
            {title}
          </h1>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
            handed off from the Advisor
            {goalText ? ` · "${goalText}"` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              borderRadius: 'var(--radius-full)',
              padding: '3px 10px',
              background: currentLifecycle.bg,
              color: currentLifecycle.ink,
              whiteSpace: 'nowrap',
            }}
          >
            {currentLifecycle.label}
          </span>
          <Btn sm onClick={onBackToAdvisor}>
            ← Back to Advisor
          </Btn>
        </div>
      </div>

      {/* Lifecycle stepper */}
      <div
        style={{
          ...CARD_STYLE,
          padding: '10px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          overflowX: 'auto',
        }}
      >
        {LIFECYCLE.map((s, i) => (
          <React.Fragment key={s.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 10.5,
                  fontWeight: 700,
                  background:
                    i < lifecycleIdx
                      ? 'var(--success)'
                      : i === lifecycleIdx
                        ? 'var(--brand)'
                        : 'var(--bg-muted)',
                  color: i <= lifecycleIdx ? '#fff' : 'var(--text-muted)',
                  flexShrink: 0,
                }}
              >
                {i < lifecycleIdx ? '✓' : i + 1}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: i === lifecycleIdx ? 700 : 500,
                  color: i === lifecycleIdx ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {s.label}
              </span>
            </div>
            {i < LIFECYCLE.length - 1 && (
              <span
                style={{
                  width: 18,
                  height: 1,
                  background: 'var(--border-strong)',
                  flexShrink: 0,
                }}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Main + sidebar layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* ── MAIN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Thesis — always reachable */}
          <div style={CARD_STYLE}>
            <div
              onClick={() => setThesisOpen((o) => !o)}
              style={{
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                borderBottom: thesisOpen ? '1px solid var(--border-card)' : 'none',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                📋 The thesis{' '}
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>
                  — why we're running this
                </span>
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {thesisOpen ? 'collapse ▲' : 'expand ▼'}
              </span>
            </div>
            {thesisOpen && (
              <div style={{ padding: '14px 16px' }}>
                <Blueprint goal={goal} slots={blueprintSlots} compact />
                <div style={{ marginTop: 12 }}>
                  {STAGES.map((s) => {
                    const supporting = aspects.filter(
                      (a) => a.stage === s.key && a.triage === 'keep',
                    );
                    if (!supporting.length) return null;
                    return (
                      <div
                        key={s.key}
                        style={{ display: 'flex', gap: 9, padding: '5px 0', fontSize: 12.5 }}
                      >
                        <span style={{ width: 20, flexShrink: 0 }}>{s.emoji}</span>
                        <span>
                          <b style={{ color: 'var(--brand)' }}>
                            {supporting[0].slot || s.label}
                          </b>
                          {supporting[0].asserted && (
                            <span style={{ color: 'var(--warning-ink)', fontWeight: 600 }}>
                              {' '}
                              (assumed)
                            </span>
                          )}{' '}
                          <span style={{ color: 'var(--text-secondary)' }}>
                            — {supporting[0].finding}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-muted)',
                    marginTop: 8,
                    fontStyle: 'italic',
                  }}
                >
                  Frozen with the experiment, so the readout still makes sense weeks from now.
                </div>
              </div>
            )}
          </div>

          {/* Delivery */}
          <div style={CARD_STYLE}>
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border-card)',
                fontWeight: 600,
                fontSize: 13.5,
              }}
            >
              🚚 Delivery{' '}
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>
                — who performs the action
              </span>
            </div>
            <div style={{ padding: '14px 16px' }}>
              {/* Delivery is owner-run for now — the in-system CS work queue is a
                  later, per-experiment-customizable path, so it's deliberately not
                  wired here. We freeze the groups and measure the outcome; the
                  delivery owner runs the action and logs progress. */}
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <div
                  style={{
                    padding: '10px 12px',
                    background: 'var(--info-soft)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--info-ink)',
                    marginBottom: 10,
                  }}
                >
                  We've frozen the two groups and we measure the outcome — your delivery owner
                  runs the action (CS calls, LiveOps, email) and logs progress here. The hold-out
                  stays untouched so the readout is still valid.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Btn
                    sm
                    onClick={() =>
                      alert('→ downloads target list: user_id + reachability flags only (no contact PII)')
                    }
                  >
                    ⬇ Export target list
                  </Btn>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>
                  Last synced: {lifecycleIdx >= 2 ? 'manual entry · today' : '—'}
                </div>
              </div>

              {/* Delivery progress */}
              {lifecycleIdx >= 2 && (
                <div style={{ marginTop: 14 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      marginBottom: 5,
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>Delivered (exposure)</span>
                    <span style={{ fontWeight: 700 }}>
                      {contacted.toLocaleString()} / {treatN.toLocaleString()}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 8,
                      background: 'var(--bg-muted)',
                      borderRadius: 'var(--radius-full)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round((contacted / treatN) * 100)}%`,
                        height: '100%',
                        background: 'var(--brand)',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      marginTop: 6,
                      lineHeight: 1.45,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    <span>
                      <b style={{ color: 'var(--text-secondary)' }}>Logged here:</b>{' '}
                      {contacted.toLocaleString()}{' '}
                      <i>(your log may lag actual delivery)</i>
                    </span>
                    <span>
                      Either way the headline is measured on <b>everyone we assigned</b>.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Monitoring — treatment vs hold-out */}
          <div style={CARD_STYLE}>
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border-card)',
                fontWeight: 600,
                fontSize: 13.5,
              }}
            >
              📈 Treatment vs hold-out{' '}
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>
                — measured on {isRevenue ? 'gross payments' : 'playtime → payments'}
              </span>
            </div>
            <div style={{ padding: '14px 16px' }}>
              {lifecycleIdx < 2 ? (
                <div
                  style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}
                >
                  Groups frozen:{' '}
                  <b style={{ color: 'var(--text-secondary)' }}>
                    {treatN.toLocaleString()} treatment
                  </b>{' '}
                  ·{' '}
                  <b style={{ color: 'var(--text-secondary)' }}>
                    {holdN.toLocaleString()} hold-out
                  </b>
                  . Outcome tracking begins when the first treatment is delivered. Nothing has run
                  yet.
                </div>
              ) : (
                <>
                  {/* Live scorecard pending / failed — surface it instead of
                      quietly showing demo bars for a real experiment. */}
                  {monitor.state.experimentId && monitor.state.assignment && !sc && (
                    <div
                      style={{
                        fontSize: 12,
                        color: monitor.state.error ? 'var(--destructive-ink)' : 'var(--text-muted)',
                        background: monitor.state.error
                          ? 'var(--destructive-soft)'
                          : 'var(--bg-muted)',
                        borderRadius: 'var(--radius-md)',
                        padding: '8px 10px',
                        marginBottom: 10,
                      }}
                    >
                      {monitor.state.busy
                        ? 'Loading real treatment-vs-hold-out outcomes…'
                        : monitor.state.error
                          ? `Couldn't load live outcomes: ${monitor.state.error}. Bars below are illustrative.`
                          : 'Live outcomes not loaded yet.'}
                    </div>
                  )}
                  {/* Status pill — real significance verdict when live, else the
                      illustrative/early labels for the demo walkthrough. */}
                  {live ? (
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        borderRadius: 'var(--radius-full)',
                        padding: '2px 8px',
                        background:
                          verdict === 'win' ? 'var(--success-soft)' : 'var(--warning-soft)',
                        color: verdict === 'win' ? 'var(--success-ink)' : 'var(--warning-ink)',
                      }}
                    >
                      {verdict === 'win'
                        ? `significant · day ${windowDays}`
                        : 'measured — not yet significant'}
                    </span>
                  ) : currentLifecycle.key !== 'readout' ? (
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        borderRadius: 'var(--radius-full)',
                        padding: '2px 8px',
                        background: 'var(--warning-soft)',
                        color: 'var(--warning-ink)',
                      }}
                    >
                      early — not yet conclusive · illustrative
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        borderRadius: 'var(--radius-full)',
                        padding: '2px 8px',
                        background: 'var(--success-soft)',
                        color: 'var(--success-ink)',
                      }}
                    >
                      clear result · day {windowDays} · illustrative
                    </span>
                  )}

                  {live ? (
                    <MiniBars
                      a={Number(treatRatePct.toFixed(2))}
                      b={Number(ctrlRatePct.toFixed(2))}
                      labelA="Treatment"
                      labelB="Hold-out"
                      unit="%"
                      max={barMax}
                    />
                  ) : isRevenue ? (
                    <MiniBars
                      a={currentLifecycle.key === 'readout' ? 22 : 18}
                      b={currentLifecycle.key === 'readout' ? 13 : 14}
                      labelA="Treatment"
                      labelB="Hold-out"
                      unit="%"
                      max={28}
                    />
                  ) : (
                    <MiniBars
                      a={currentLifecycle.key === 'readout' ? 4.6 : 3.1}
                      b={currentLifecycle.key === 'readout' ? 2.4 : 2.6}
                      labelA="Treatment"
                      labelB="Hold-out"
                      unit="/wk"
                      max={6}
                    />
                  )}

                  {(live || currentLifecycle.key === 'readout') && (
                    <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 12 }}>
                      Did it work?{' '}
                      <span
                        style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}
                      >
                        — re-pay rate, measured on everyone we assigned (the number you can trust)
                      </span>
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 12.5,
                      marginTop: live || currentLifecycle.key === 'readout' ? 5 : 12,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.5,
                    }}
                  >
                    {live ? (
                      verdict === 'win' ? (
                        <>
                          <b style={{ color: 'var(--positive, var(--success))' }}>
                            Yes — +{liftPp.toFixed(1)} payers in 100
                          </b>{' '}
                          vs the hold-out, beyond chance (p&lt;0.05).
                          {rolloutVnd > 0 && (
                            <>
                              {' '}≈ <b>{fmtVnd(rolloutVnd)}</b> if the lift held when rolled out to
                              the held-back group.
                            </>
                          )}
                        </>
                      ) : liftPp > 0 ? (
                        <>
                          <b>+{liftPp.toFixed(1)} payers in 100</b> vs the hold-out, but inside the
                          noise band — keep measuring to day {windowDays}.
                        </>
                      ) : (
                        <>
                          No positive difference vs the hold-out so far ({liftPp.toFixed(1)} pp) —
                          keep measuring to day {windowDays}.
                        </>
                      )
                    ) : currentLifecycle.key === 'readout' ? (
                      isRevenue ? (
                        <>
                          <b style={{ color: 'var(--positive, var(--success))' }}>
                            Yes — +9 payers in 100
                          </b>{' '}
                          vs the hold-out, beyond chance. ≈{' '}
                          <b>+312M₫</b> if rolled out to the held-back group.{' '}
                          <span style={{ color: 'var(--text-muted)' }}>
                            Among those CS confirmed reaching, the lift was stronger.
                          </span>
                        </>
                      ) : (
                        <>
                          <b style={{ color: 'var(--positive, var(--success))' }}>
                            Yes — +2.2 sessions/week
                          </b>{' '}
                          vs the hold-out; revenue follow-through still accruing.
                        </>
                      )
                    ) : (
                      'Difference is forming but inside the noise band — keep measuring to day ' +
                      windowDays +
                      '.'
                    )}
                  </div>
                  {(live || (currentLifecycle.key === 'readout' && isRevenue)) && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                      Gross payments{live && sc!.currencies.length > 1
                        ? ` (${sc!.currencies.join('+')}, normalized to VND)`
                        : ''}{' '}
                      — before refunds & costs.
                    </div>
                  )}
                  {currentLifecycle.key === 'readout' && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                      <Btn
                        sm
                        kind="primary"
                        onClick={() =>
                          alert('→ roll the winning treatment out to the held-back group')
                        }
                      >
                        Roll out to hold-out →
                      </Btn>
                      <Btn
                        sm
                        onClick={() =>
                          alert('→ archive; result feeds the Treatment-Effect Library')
                        }
                      >
                        Archive & bank the learning
                      </Btn>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Lifecycle CTA */}
          {ctaLabel[currentLifecycle.key] && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Btn kind="primary" onClick={advance}>
                {ctaLabel[currentLifecycle.key]}
              </Btn>
            </div>
          )}
        </div>

        {/* ── SIDEBAR ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* At a glance */}
          <div style={{ ...CARD_STYLE, padding: '14px 16px' }}>
            <div style={{ ...EYEBROW_STYLE, marginBottom: 9 }}>At a glance</div>
            {[
              ['Cohort', 'Lapsing whales'],
              ['Treatment', treatN.toLocaleString()],
              ['Hold-out', holdN.toLocaleString()],
              ['Window', `${windowDays} days`],
              ['Expected', blueprintSlots.proof?.text ?? (isRevenue ? '+6 in 100 (prior)' : '+0.4/wk (bet)')],
              ['Success metric', isRevenue ? 'gross payment rate' : 'sessions / week'],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '4px 0',
                  fontSize: 12.5,
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                <span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Guardrails */}
          <div style={{ ...CARD_STYLE, padding: '14px 16px' }}>
            <div style={{ ...EYEBROW_STYLE, marginBottom: 9 }}>🛟 Guardrails</div>
            {[
              `Won't contact anyone who paid in the last 7 days`,
              'Max 1 contact per player',
              'Hold-out is never touched',
              'Gross revenue only (no refund signal)',
            ].map((g) => (
              <div
                key={g}
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  gap: 7,
                  padding: '3px 0',
                  lineHeight: 1.4,
                }}
              >
                <span style={{ color: 'var(--success-ink)' }}>✓</span>
                <span>{g}</span>
              </div>
            ))}
          </div>

          {/* Provenance */}
          <div style={{ ...CARD_STYLE, padding: '14px 16px' }}>
            <div style={{ ...EYEBROW_STYLE, marginBottom: 9 }}>Provenance</div>
            {[
              ['↗ Open cohort in Segments', 'the frozen assignment list'],
              ['↗ Outcome query in Playground', 'treatment vs hold-out SQL'],
              ['↗ Assignment log', 'immutable, in the lakehouse'],
            ].map(([label, sub]) => (
              <button
                key={label}
                onClick={() => alert(`→ ${sub} (requires live Cube connection)`)}
                style={{
                  fontFamily: 'var(--font-sans)',
                  display: 'block',
                  textAlign: 'left',
                  width: '100%',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  padding: '4px 0',
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--info-ink)' }}>
                  {label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
