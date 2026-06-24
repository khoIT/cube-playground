/**
 * EventTimelineView — Diagnostics "Event timeline" tab.
 *
 * Renders a 30-day DAU sparkline (sourced from the cached KPI strip) overlaid
 * with annotation flags (patches / events / campaigns / incidents). Clicking a
 * flag opens EventDetailPanel. Type-filter chips control visibility.
 * Add/edit uses the EventEditor inline form.
 *
 * Token-only styles; no raw hex outside the recharts fills (inherits CHART palette).
 */

import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Plus, RefreshCw } from 'lucide-react';
import { useGameContext } from '../../../../components/Header/use-game-context';
import { useLiveKpis } from '../../use-live-kpis';
import { useChartAnnotations } from '../../../../hooks/use-chart-annotations';
import { createAnnotation, updateAnnotation, deleteAnnotation } from '../../../../api/chart-annotations';
import type { ChartAnnotation, AnnotationType, CreateAnnotationInput } from '../../../../api/chart-annotations';
import { AnnotationOverlay } from '../../../../components/charts/annotation-overlay';
import { EventDetailPanel } from './event-detail-panel';
import { EventEditor } from './event-editor';
import { buildMockEvents, isMockEvent } from './mock-events';
import { CHART } from '../../../../shell/theme';
import { makeTimeTickFormatter } from '../../../../utils/format-chart-datetime-label';
import { formatCompact } from '../../../OpsConsole/ops-format';

// ── Type filter chips ─────────────────────────────────────────────────────────

const ALL_TYPES: AnnotationType[] = ['patch', 'event', 'campaign', 'incident'];

const TYPE_LABELS: Record<AnnotationType, string> = {
  patch:    'Patches',
  event:    'Events',
  campaign: 'Campaigns',
  incident: 'Incidents',
};

const TYPE_INK: Record<AnnotationType, string> = {
  patch:    'var(--info-ink)',
  event:    'var(--success-ink)',
  campaign: 'var(--brand)',
  incident: 'var(--destructive-ink)',
};

const TYPE_SOFT: Record<AnnotationType, string> = {
  patch:    'var(--info-soft)',
  event:    'var(--success-soft)',
  campaign: 'var(--muted-soft)',
  incident: 'var(--destructive-soft)',
};

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Build an array of YYYY-MM-DD strings going back `n` days from today. */
function buildDateRange(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-xl)',
  padding: 20,
  fontFamily: 'var(--font-sans)',
};

const sectionHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 10,
  marginBottom: 16,
};

const chipBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 12px',
  borderRadius: 99,
  fontSize: 12,
  fontWeight: 600,
  border: '1.5px solid transparent',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  transition: 'opacity 0.1s',
};

const iconBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 14px',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'var(--font-sans)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};

// ── Component ─────────────────────────────────────────────────────────────────

type EditorMode = { kind: 'add' } | { kind: 'edit'; annotation: ChartAnnotation } | null;

export function EventTimelineView() {
  const { gameId } = useGameContext();
  const WINDOW_DAYS = 30;

  // Date range for annotation fetch: last 30 days
  const dateRange = useMemo(() => buildDateRange(WINDOW_DAYS), []);
  const from = dateRange[0];
  const to = dateRange[dateRange.length - 1];

  // KPI strip for DAU sparkline
  const { tiles, loading: kpiLoading } = useLiveKpis(gameId);
  const dauTile = tiles.find((t) => t.id === 'dau');
  const sparkline: number[] = dauTile?.sparkline ?? [];

  // Build chart data by zipping dates + sparkline (sparkline is newest-last, same length)
  const chartData = useMemo(() => {
    if (!sparkline.length) return dateRange.map((date) => ({ date, dau: null }));
    // Sparkline length may be shorter than WINDOW_DAYS — align to the end
    const aligned = dateRange.map((date, i) => {
      const offset = dateRange.length - sparkline.length;
      const val = i >= offset ? sparkline[i - offset] : null;
      return { date, dau: val };
    });
    return aligned;
  }, [dateRange, sparkline]);

  const categoryDomain = useMemo(() => chartData.map((r) => r.date), [chartData]);
  const categoryTick = makeTimeTickFormatter(categoryDomain);

  // Annotations
  const { annotations, loading: annLoading, refetch } = useChartAnnotations({ game: gameId, from, to });

  // Mock events mapped onto the real visible window — the calendar has no feed
  // yet, so these illustrate the experience. Clearly labelled "Mocked" in the UI.
  const mockEvents = useMemo(() => buildMockEvents(from, to, gameId), [from, to, gameId]);
  const mockStatsById = useMemo(() => {
    const m = new Map<number, Array<[string, string]>>();
    for (const e of mockEvents) m.set(e.annotation.id, e.stats);
    return m;
  }, [mockEvents]);
  const allAnnotations = useMemo(
    () => [...mockEvents.map((e) => e.annotation), ...annotations],
    [mockEvents, annotations],
  );

  // Type filter — all on by default
  const [activeTypes, setActiveTypes] = useState<Set<AnnotationType>>(new Set(ALL_TYPES));
  const toggleType = (t: AnnotationType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  };

  const filtered = useMemo(
    () => allAnnotations.filter((a) => activeTypes.has(a.type)),
    [allAnnotations, activeTypes],
  );

  // Selected annotation for detail panel
  const [selected, setSelected] = useState<ChartAnnotation | null>(null);
  // Editor mode
  const [editor, setEditor] = useState<EditorMode>(null);

  // ── CRUD handlers ─────────────────────────────────────────────────────────

  async function handleSave(input: CreateAnnotationInput) {
    if (editor?.kind === 'edit') {
      await updateAnnotation(editor.annotation.id, {
        type: input.type,
        title: input.title,
        starts_at: input.starts_at,
        ends_at: input.ends_at ?? null,
        url: input.url ?? null,
      });
    } else {
      await createAnnotation(input);
    }
    setEditor(null);
    setSelected(null);
    refetch();
  }

  async function handleDelete(id: number) {
    await deleteAnnotation(id);
    setSelected(null);
    refetch();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isLoading = kpiLoading || annLoading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 16 }}>
      {/* ── Chart card ── */}
      <div style={card}>
        <div style={sectionHead}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
              DAU trend + events
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Last {WINDOW_DAYS} days · {gameId}
              {isLoading && <RefreshCw size={10} style={{ marginLeft: 6, opacity: 0.5 }} />}
            </div>
          </div>

          {/* Type filter chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ALL_TYPES.map((t) => {
              const on = activeTypes.has(t);
              return (
                <button
                  key={t}
                  style={{
                    ...chipBase,
                    background: on ? TYPE_SOFT[t] : 'transparent',
                    color: on ? TYPE_INK[t] : 'var(--text-muted)',
                    borderColor: on ? TYPE_INK[t] : 'var(--border-card)',
                    opacity: on ? 1 : 0.55,
                  }}
                  onClick={() => toggleType(t)}
                >
                  {TYPE_LABELS[t]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Chart */}
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-card)" />
            <XAxis
              dataKey="date"
              stroke="var(--text-muted)"
              fontSize={11}
              tickFormatter={categoryTick}
            />
            <YAxis
              stroke="var(--text-muted)"
              fontSize={11}
              tickFormatter={(v: number) => formatCompact(v)}
            />
            <Tooltip
              formatter={(v: number | string) => [typeof v === 'number' ? formatCompact(v) : v, 'DAU']}
              labelFormatter={(l: string) => l}
              contentStyle={{ fontFamily: 'var(--font-sans)', fontSize: 12 }}
            />
            <Line
              type="monotone"
              dataKey="dau"
              stroke={CHART[0]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            {AnnotationOverlay({
              annotations: filtered,
              categoryDomain,
              onAnnotationClick: (ann) => {
                setSelected(ann);
                setEditor(null);
              },
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Honest disclosure — the flags below are illustrative, not a live feed */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
          background: 'var(--info-soft)',
          border: '1px solid var(--info-ink)',
          borderRadius: 'var(--radius-md)',
          padding: '9px 12px',
          fontSize: 12,
          color: 'var(--info-ink)',
          lineHeight: 1.45,
        }}
      >
        <span aria-hidden>ⓘ</span>
        <span>
          Event flags are <b>mocked examples</b> placed on the real DAU date range to show the intended experience —
          impact figures in the detail panel are not measured. The annotation calendar (add / edit / delete) is live;
          a populated event feed and computed event-impact analytics are not built yet.
        </span>
      </div>

      {/* ── Event list + add button ── */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Left: event list */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              Events ({filtered.length})
            </span>
            <button
              style={{ ...iconBtn, color: 'var(--brand)', borderColor: 'var(--brand)' }}
              onClick={() => { setEditor({ kind: 'add' }); setSelected(null); }}
            >
              <Plus size={13} /> Add event
            </button>
          </div>

          {/* Inline editor */}
          {editor && (
            <div style={{ marginBottom: 12 }}>
              <EventEditor
                game={gameId}
                existing={editor.kind === 'edit' ? editor.annotation : undefined}
                onSave={handleSave}
                onCancel={() => setEditor(null)}
              />
            </div>
          )}

          {/* Annotation rows */}
          {filtered.length === 0 && !editor ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--text-muted)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              No events in this window — add one to annotate the trend.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtered.map((ann) => (
                <AnnotationRow
                  key={ann.id}
                  annotation={ann}
                  isSelected={selected?.id === ann.id}
                  onClick={() => { setSelected(ann); setEditor(null); }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: detail panel (when an annotation is selected and not editing) */}
        {selected && !editor && (
          <EventDetailPanel
            annotation={selected}
            mockStats={isMockEvent(selected) ? mockStatsById.get(selected.id) : undefined}
            onClose={() => setSelected(null)}
            onEdit={(ann) => { setEditor({ kind: 'edit', annotation: ann }); }}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
}

// ── Annotation list row ───────────────────────────────────────────────────────

function AnnotationRow({
  annotation,
  isSelected,
  onClick,
}: {
  annotation: ChartAnnotation;
  isSelected: boolean;
  onClick: () => void;
}) {
  const ink = TYPE_INK[annotation.type];
  const soft = TYPE_SOFT[annotation.type];

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '10px 14px',
        background: isSelected ? soft : 'var(--bg-card)',
        border: `1px solid ${isSelected ? ink : 'var(--border-card)'}`,
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'var(--font-sans)',
        transition: 'background 0.1s',
      }}
    >
      {/* Type dot */}
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: ink,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {annotation.title}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {annotation.game ?? 'Global'} · {annotation.starts_at}
          {annotation.ends_at ? ` → ${annotation.ends_at}` : ''}
        </span>
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: ink,
          background: soft,
          padding: '2px 7px',
          borderRadius: 99,
          flexShrink: 0,
        }}
      >
        {annotation.type}
      </span>
    </button>
  );
}
