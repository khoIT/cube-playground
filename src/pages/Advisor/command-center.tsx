/**
 * CommandCenter — hand-off and monitoring surface for a scaffolded experiment draft.
 *
 * Design stance:
 *   - status=draft until the manager explicitly freezes groups
 *   - Delivery is pluggable: in-system CS queue OR external/manual
 *   - Outcome tracking reads billing — monitoring works regardless of delivery path
 *   - "Did it work?" leads the readout; UID match rate is framed as confirmed-reach
 *     coverage (not "tool lost track")
 *
 * In this build the ExperimentDraft from /api/advisor/handoff populates the sidebar
 * "At a glance" panel. If handoff hasn't completed yet (e.g. no live Cube) the
 * screen degrades gracefully showing the investigation-derived values instead.
 */
import React, { useState } from 'react';
import type { Aspect, GoalKey, BlueprintSlots } from './advisor-types';
import type { ExperimentDraft } from '../../api/advisor';
import { STAGES } from './advisor-stage-config';
import { Blueprint } from './blueprint';
import { Btn, CARD_STYLE, EYEBROW_STYLE, MiniBars } from './advisor-primitives';

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
  onBackToAdvisor: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function CommandCenter({
  goal,
  aspects,
  goalText,
  blueprintSlots,
  split,
  draft,
  onBackToAdvisor,
}: CommandCenterProps) {
  const [lifecycleIdx, setLifecycleIdx] = useState(0);
  const [deliveryMode, setDeliveryMode] = useState<'cs' | 'external'>('cs');
  const [thesisOpen, setThesisOpen] = useState(true);

  const currentLifecycle = LIFECYCLE[lifecycleIdx];
  const isRevenue = goal === 'revenue';
  const lever = aspects.find((a) => a.stage === 'lever' && a.triage === 'keep');

  // Cohort sizes — prefer draft values, fall back to illustrative demo numbers
  const reachableN = draft?.cohort.addressableN ?? 1872;
  const treatN = draft
    ? Math.round(reachableN * ((draft.arms.find((a) => a.key === 'treatment')?.share ?? split / 100)))
    : Math.round(reachableN * (split / 100));
  const holdN = reachableN - treatN;
  const windowDays = draft?.windowDays ?? 14;

  const title = `${lever?.q ?? 'Experiment'} · investigation`;

  // Illustrative contact progress (only shown in delivering/measuring/readout)
  const contacted =
    currentLifecycle.key === 'delivering'
      ? Math.round(treatN * 0.42)
      : ['measuring', 'readout'].includes(currentLifecycle.key)
        ? Math.round(treatN * 0.96)
        : 0;

  const advance = () =>
    setLifecycleIdx((i) => Math.min(LIFECYCLE.length - 1, i + 1));

  const ctaLabel: Record<LifecycleKey, string | null> = {
    draft: 'Confirm & freeze the groups →',
    frozen:
      deliveryMode === 'cs' ? 'Start delivery (open CS queue) →' : 'Mark delivery started →',
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
          <div style={EYEBROW_STYLE}>⌂ Command Center · Experiments</div>
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
              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {(
                  [
                    ['cs', 'CS Work Queue', 'inside cube-playground'],
                    ['external', 'Delivered elsewhere', 'LiveOps / email / manual'],
                  ] as const
                ).map(([k, label, sub]) => (
                  <button
                    key={k}
                    onClick={() => setDeliveryMode(k)}
                    style={{
                      fontFamily: 'var(--font-sans)',
                      flex: 1,
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      border: `1px solid ${deliveryMode === k ? 'var(--brand)' : 'var(--border-strong)'}`,
                      background: deliveryMode === k ? 'var(--bg-muted)' : 'var(--bg-card)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: deliveryMode === k ? 'var(--brand)' : 'var(--text-primary)',
                      }}
                    >
                      {label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                      {sub}
                    </div>
                  </button>
                ))}
              </div>

              {deliveryMode === 'cs' ? (
                <div
                  style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}
                >
                  We hand CS a <b>no-PII target list</b> of {treatN.toLocaleString()} (user_id +
                  reachability only). They work it from the Care console; delivery syncs back
                  automatically from CS logs.
                  {lifecycleIdx >= 1 && (
                    <div style={{ marginTop: 10 }}>
                      <Btn
                        sm
                        kind="primary"
                        onClick={() =>
                          alert(`→ opens the CS Work Queue with this experiment's treatment arm`)
                        }
                      >
                        Open CS Work Queue →
                      </Btn>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}
                >
                  <div
                    style={{
                      padding: '10px 12px',
                      background: 'var(--info-soft)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--info-ink)',
                      marginBottom: 10,
                    }}
                  >
                    This action runs <b>outside cube-playground</b>. We've frozen the two groups
                    and we measure the outcome — your delivery owner runs the action and logs
                    progress here. The hold-out stays untouched so the readout is still valid.
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
                  <div
                    style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}
                  >
                    Last synced: {lifecycleIdx >= 2 ? 'manual entry · today' : '—'}
                  </div>
                </div>
              )}

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
                  {deliveryMode === 'cs' ? (
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        marginTop: 6,
                        lineHeight: 1.45,
                      }}
                    >
                      <b style={{ color: 'var(--text-secondary)' }}>
                        Confirmed-reach coverage ≈ 23%
                      </b>{' '}
                      (we can match that share of CS logs to a uid). This does <b>not</b> change
                      the headline — the result is measured on{' '}
                      <b>everyone we assigned</b>; the confirmed-reached subset is just a bonus
                      read.
                    </div>
                  ) : (
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
                        <b style={{ color: 'var(--text-secondary)' }}>CS says delivered:</b>{' '}
                        {Math.round(treatN * 0.98).toLocaleString()}
                      </span>
                      <span>
                        <b style={{ color: 'var(--text-secondary)' }}>Logged here:</b>{' '}
                        {contacted.toLocaleString()}{' '}
                        <i>(your log may lag actual delivery)</i>
                      </span>
                      <span>
                        Either way the headline is measured on{' '}
                        <b>everyone we assigned</b>.
                      </span>
                    </div>
                  )}
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
                  {currentLifecycle.key !== 'readout' && (
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
                  )}
                  {currentLifecycle.key === 'readout' && (
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
                      clear result · day {windowDays}
                    </span>
                  )}
                  {isRevenue ? (
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
                  {currentLifecycle.key === 'readout' && (
                    <div
                      style={{ fontSize: 13.5, fontWeight: 700, marginTop: 12 }}
                    >
                      Did it work?{' '}
                      <span
                        style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}
                      >
                        — measured on everyone we assigned (the number you can trust)
                      </span>
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 12.5,
                      marginTop: currentLifecycle.key === 'readout' ? 5 : 12,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.5,
                    }}
                  >
                    {currentLifecycle.key === 'readout' ? (
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
                  {currentLifecycle.key === 'readout' && isRevenue && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                      Gross payments — before refunds & costs.
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
