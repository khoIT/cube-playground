/**
 * Lifecycle flow view — Diagnostics tab 3.
 *
 * Five state stat-cards (New / Core / Lapsing / Reactivated / Churned) with
 * real Cube counts from mf_users (current snapshot). Transition ribbons are
 * disclosed-empty: mf_users holds only current state with no history, so
 * week-over-week flow cannot be computed yet.
 *
 * "Seed a segment" button opens the Segments editor pre-seeded with the
 * at-risk cohort (Lapsing: paying users inactive 7–30 days).
 *
 * State thresholds are disclosed in a tooltip on the info icon.
 */
import React from 'react';
import { useHistory } from 'react-router-dom';
import { Info, Sprout, Star, TrendingDown, RefreshCcw, XCircle, Layers } from 'lucide-react';
import { useGameContext } from '../../../../components/Header/use-game-context';
import { stashEditorPrefill } from '../../../Segments/editor/editor-prefill-store';
import type { EditorLocationState } from '../../../Segments/editor/editor-route-state';
import { useLifecycleFlow } from './use-lifecycle-flow';
import { LifecycleSankey, type SankeyStateNode } from './lifecycle-sankey';
import type { LifecycleStateName } from '../../../../api/lifecycle-flow-client';

// ── Styles ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-xl)',
  padding: 16,
  fontFamily: 'var(--font-sans)',
};

const statGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: 10,
};

// ── State metadata ────────────────────────────────────────────────────────────

interface StateConfig {
  label: string;
  icon: React.ElementType;
  fill: string;
  ink: string;
  /** Tooltip definition of the threshold rule. */
  definition: string;
  /** The cube segment filter predicate to seed the editor. */
  editorCube: string;
  isAtRisk?: boolean;
}

const STATE_CONFIG: Record<LifecycleStateName, StateConfig> = {
  new: {
    label: 'New',
    icon: Sprout,
    fill: 'var(--info-soft)',
    ink: 'var(--info-ink)',
    definition: 'Install date ≥ today−7d',
    editorCube: 'mf_users',
  },
  core: {
    label: 'Core',
    icon: Star,
    fill: 'var(--success-soft)',
    ink: 'var(--success-ink)',
    definition: 'Active today or 7d AND paying',
    editorCube: 'mf_users',
  },
  lapsing: {
    label: 'Lapsing',
    icon: TrendingDown,
    fill: 'var(--warning-soft)',
    ink: 'var(--warning-ink)',
    definition: 'Active 7–30d AND paying — at-risk payer',
    editorCube: 'mf_users',
    isAtRisk: true,
  },
  reactivated: {
    label: 'Reactivated',
    icon: RefreshCcw,
    fill: 'color-mix(in srgb, var(--brand) 12%, transparent)',
    ink: 'var(--brand)',
    definition: 'Churned/dormant AND currently paying',
    editorCube: 'mf_users',
  },
  churned: {
    label: 'Churned',
    icon: XCircle,
    fill: 'var(--destructive-soft)',
    ink: 'var(--destructive-ink)',
    definition: 'Dormant/churned AND not paying',
    editorCube: 'mf_users',
  },
};

const STATE_ORDER: LifecycleStateName[] = ['new', 'core', 'lapsing', 'reactivated', 'churned'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StateCard({
  name,
  count,
  onSeed,
}: {
  name: LifecycleStateName;
  count: number;
  onSeed?: () => void;
}) {
  const cfg = STATE_CONFIG[name];
  const Icon = cfg.icon;

  return (
    <div
      style={{
        background: cfg.fill,
        borderRadius: 'var(--radius-lg)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        position: 'relative',
        cursor: cfg.isAtRisk && onSeed ? 'default' : undefined,
        border: cfg.isAtRisk ? `1px solid ${cfg.ink}` : '1px solid transparent',
      }}
      title={cfg.definition}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon size={13} style={{ color: cfg.ink, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: cfg.ink, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {cfg.label}
        </span>
        {cfg.isAtRisk && (
          <span style={{ fontSize: 10, background: cfg.ink, color: 'var(--text-on-brand)', borderRadius: 4, padding: '1px 5px', marginLeft: 'auto' }}>
            At risk
          </span>
        )}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: cfg.ink, lineHeight: 1 }}>
        {formatCount(count)}
      </div>
      <div style={{ fontSize: 10, color: cfg.ink, opacity: 0.7 }}>{cfg.definition}</div>
      {cfg.isAtRisk && onSeed && (
        <button
          type="button"
          onClick={onSeed}
          style={{
            marginTop: 4,
            padding: '4px 8px',
            fontSize: 10,
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            border: `1px solid ${cfg.ink}`,
            borderRadius: 'var(--radius-md)',
            background: 'transparent',
            color: cfg.ink,
            cursor: 'pointer',
          }}
        >
          Seed a segment →
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const THRESHOLD_TOOLTIP =
  'State thresholds — New: install ≥ today−7d · Core: active ≤7d + paying · ' +
  'Lapsing: active 7–30d + paying · Reactivated: churned/dormant + paying · ' +
  'Churned: dormant/churned + not paying. Source: mf_users current snapshot.';

export function LifecycleFlowView() {
  const { gameId } = useGameContext();
  const history = useHistory();
  const { data, loading, error } = useLifecycleFlow(gameId);

  function seedLapsingSegment() {
    // Pre-seed the Segments editor with the at-risk paying cohort (Lapsing state).
    // Uses the at_risk_paying segment defined in mf_users (paying users inactive 7–30d).
    const state: EditorLocationState = {
      advisorPrefill: {
        name: `${gameId} — Lapsing payers (at-risk)`,
        cube: 'mf_users',
        predicateTree: {
          type: 'and',
          children: [
            { type: 'leaf', member: 'mf_users.churn_risk', operator: 'equals', values: ['at_risk'] },
          ],
        } as Parameters<typeof stashEditorPrefill>[0]['advisorPrefill'] extends infer P ? P : never,
      },
      returnTo: { pathTemplate: '/liveops/diagnostics?tab=lifecycle' },
    };
    stashEditorPrefill(state);
    history.push('/segments/new', state);
  }

  const sankeyNodes: SankeyStateNode[] = data
    ? STATE_ORDER.map((name) => ({
        state: name,
        label: STATE_CONFIG[name].label,
        count: data.states[name],
      }))
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
      {/* State stat-cards */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Layers size={14} style={{ color: 'var(--brand)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Current state snapshot
          </span>
          <span
            style={{ marginLeft: 2, cursor: 'help', color: 'var(--text-muted)' }}
            title={THRESHOLD_TOOLTIP}
          >
            <Info size={12} />
          </span>
          {data && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
              {new Date(data.snapshotAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {loading && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '20px 0' }}>
            Loading lifecycle data…
          </div>
        )}
        {error && (
          <div style={{ fontSize: 13, color: 'var(--destructive-ink)', padding: '20px 0' }}>
            {error}
          </div>
        )}
        {data && (
          <div style={statGrid}>
            {STATE_ORDER.map((name) => (
              <StateCard
                key={name}
                name={name}
                count={data.states[name]}
                onSeed={name === 'lapsing' ? seedLapsingSegment : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sankey flow */}
      <div style={{ ...card, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Week-over-week flow
          </span>
        </div>
        {data ? (
          <LifecycleSankey
            nodes={sankeyNodes}
            transitions={data.transitions}
            transitionMeta={data.transitionMeta}
            transitionsUnavailableReason={data.transitionsUnavailableReason}
            width={560}
            height={320}
          />
        ) : (
          !loading && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No data available.</div>
          )
        )}
      </div>
    </div>
  );
}
