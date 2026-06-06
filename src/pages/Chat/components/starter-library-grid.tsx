/**
 * StarterLibraryGrid — clickable card grid of pregenerated business
 * questions. Click → onPick(starter); the parent (chat-empty-hero) submits
 * the question immediately so a demo click yields an instant answer.
 *
 * Each card carries:
 *   - topic pills (semantic-token colored: LiveOps / UA / Monetization)
 *   - an output-hint icon predicting the answer shape (ranking, trend, …)
 *   - a "Data through <date>" badge when the cube lags >14 days (serve-time
 *     `dataThrough` enrichment) — stale data as transparency, not confusion.
 *
 * Filtering by topic happens in the parent; this is a pure list renderer.
 */
import React from 'react';
import {
  BarChart3,
  TrendingUp,
  ArrowLeftRight,
  Filter,
  PieChart,
  type LucideIcon,
} from 'lucide-react';
import { T } from '../../../shell/theme';
import {
  STARTER_TOPIC_LABELS,
  STARTER_TOPIC_COLORS,
  type StarterQuestion,
} from '../library/starter-questions';
import {
  inferOutputHint,
  OUTPUT_HINT_LABELS,
  type StarterOutputHint,
} from '../library/starter-output-hint';

const HINT_ICONS: Record<StarterOutputHint, LucideIcon> = {
  ranking: BarChart3,
  trend: TrendingUp,
  comparison: ArrowLeftRight,
  funnel: Filter,
  breakdown: PieChart,
};

interface Props {
  starters: ReadonlyArray<StarterQuestion>;
  onPick: (starter: StarterQuestion) => void;
}

export function StarterLibraryGrid({ starters, onPick }: Props) {
  return (
    <div
      data-testid="starter-library-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 10,
        width: '100%',
        marginTop: 16,
      }}
    >
      {starters.map((s) => (
        <StarterCard key={s.id} starter={s} onPick={onPick} />
      ))}
    </div>
  );
}

/** "2026-04-30" → "Apr 30" (year omitted — badge stays compact). */
function formatDataThrough(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function StarterCard({
  starter,
  onPick,
}: {
  starter: StarterQuestion;
  onPick: (s: StarterQuestion) => void;
}) {
  const hint = inferOutputHint(starter);
  const HintIcon = HINT_ICONS[hint];
  return (
    <button
      type="button"
      onClick={() => onPick(starter)}
      data-starter-id={starter.id}
      style={{
        textAlign: 'left',
        padding: '12px 14px',
        border: `1px solid ${T.n300}`,
        borderRadius: 12,
        background: T.surface,
        cursor: 'pointer',
        fontFamily: T.fSans,
        fontSize: 13,
        color: T.n800,
        lineHeight: 1.45,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'background 0.15s, border-color 0.15s, transform 0.05s',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = T.surfaceSubtle;
        el.style.borderColor = T.n400;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = T.surface;
        el.style.borderColor = T.n300;
      }}
      onMouseDown={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)';
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
      }}
    >
      <div style={{ fontWeight: 500, flex: 1 }}>{starter.text}</div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        {(starter.topicTags ?? []).map((t) => {
          const colors = STARTER_TOPIC_COLORS[t];
          return (
            <span
              key={t}
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                background: colors?.soft ?? 'var(--muted-soft)',
                color: colors?.ink ?? 'var(--muted-ink)',
              }}
            >
              {STARTER_TOPIC_LABELS[t] ?? t}
            </span>
          );
        })}
        {starter.dataThrough && (
          <span
            data-testid="data-through-badge"
            title={`This cube's data currently ends on ${starter.dataThrough}`}
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 500,
              background: 'var(--muted-soft)',
              color: 'var(--muted-ink)',
              whiteSpace: 'nowrap',
            }}
          >
            Data through {formatDataThrough(starter.dataThrough)}
          </span>
        )}
        <span
          title={OUTPUT_HINT_LABELS[hint]}
          aria-label={OUTPUT_HINT_LABELS[hint]}
          style={{ marginLeft: 'auto', display: 'inline-flex', color: T.n500 }}
        >
          <HintIcon size={14} strokeWidth={1.8} />
        </span>
      </div>
    </button>
  );
}
