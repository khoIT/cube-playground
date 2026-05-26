/**
 * ChartSectionMenu — top-right view-switcher for AssistantChartSection.
 *
 * Lets the user:
 *   - switch between chart and data-table view
 *   - pick a compatible alternative chart type (data-shape aware)
 *   - export the underlying data as CSV
 *
 * Compatible chart types are derived from the spec's encoding: series-encoded
 * data maps to stacked-bar / multi-line; pie/donut share a group; scatter is
 * standalone; everything else falls back to the single-series bar/line family.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, BarChart3, LineChart as LineChartIcon, Table2, Download, Check } from 'lucide-react';
import { T, Icon, type LucideIcon } from '../../../shell/theme';
import type { ChartSpec } from '../../../api/chat-sse-client';

const TYPE_LABEL: Record<ChartSpec['type'], string> = {
  bar: 'Bar',
  'horizontal-bar': 'Horizontal bar',
  line: 'Line',
  'multi-line': 'Multi-line',
  area: 'Area',
  'stacked-bar': 'Stacked bar',
  'grouped-bar': 'Grouped bar',
  pie: 'Pie',
  donut: 'Donut',
  scatter: 'Scatter',
  funnel: 'Funnel',
};

// Mirrors PIE_MAX_ROWS in chat-service/src/services/chart-spec.ts — pie/donut
// only read with a small number of slices.
const PIE_MAX_SLICES = 12;

/** A column is numeric when every row's value is a finite number (or numeric string). */
export function isNumericColumn(
  rows: Array<Record<string, string | number>>,
  col: string,
): boolean {
  if (rows.length === 0) return false;
  return rows.every((r) => {
    const v = r[col];
    if (typeof v === 'number') return Number.isFinite(v);
    return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));
  });
}

/** Names of the all-numeric columns in a data table (drives scatter eligibility). */
export function numericColumns(rows: Array<Record<string, string | number>>): string[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]).filter((c) => isNumericColumn(rows, c));
}

/**
 * Re-encode a category×value spec as a scatter: pick two numeric columns for the
 * axes (keeping the originally-charted `value` as one axis for continuity), and
 * leave the remaining column to label each point. Only meaningful when the rows
 * carry ≥2 numeric columns — guarded by `compatibleChartTypes`.
 */
export function toScatterSpec(spec: ChartSpec): ChartSpec {
  const nums = numericColumns(spec.data);
  const y = isNumericColumn(spec.data, spec.encoding.value) ? spec.encoding.value : nums[0];
  const x = nums.find((c) => c !== y) ?? nums[0];
  return { ...spec, type: 'scatter', encoding: { category: x, value: y } } as ChartSpec;
}

/**
 * Every chart type that can sensibly render this spec's data shape — drives the
 * "switch chart type" menu so the user can explore all valid views of a table.
 *
 * - series-encoded (category + value + series): the multi-series families.
 * - an already-scatter / funnel spec is a distinct intent that doesn't
 *   interchange with the category×value set, so it stays isolated.
 * - otherwise it's category×value: offer the full single-series set, plus
 *   pie/donut when there are few enough slices to read, plus scatter when the
 *   rows carry ≥2 numeric columns (e.g. two metrics per entity → correlation).
 */
export function compatibleChartTypes(spec: ChartSpec): ChartSpec['type'][] {
  if (spec.encoding.series) return ['grouped-bar', 'stacked-bar', 'multi-line'];
  if (spec.type === 'scatter') return ['scatter'];
  if (spec.type === 'funnel') return ['funnel'];

  const types: ChartSpec['type'][] = ['bar', 'horizontal-bar', 'line', 'area'];
  if (spec.data.length >= 1 && spec.data.length <= PIE_MAX_SLICES) {
    types.push('pie', 'donut');
  }
  if (numericColumns(spec.data).length >= 2) {
    types.push('scatter');
  }
  return types;
}

export function toCsv(rows: Array<Record<string, string | number>>): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.map(escape).join(',');
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'chart-data';
}

interface ChartSectionMenuProps {
  spec: ChartSpec;
  view: 'chart' | 'table';
  activeType: ChartSpec['type'];
  rows: Array<Record<string, string | number>>;
  onShowChart: () => void;
  onShowTable: () => void;
  onChangeType: (t: ChartSpec['type']) => void;
}

export function ChartSectionMenu({
  spec,
  view,
  activeType,
  rows,
  onShowChart,
  onShowTable,
  onChangeType,
}: ChartSectionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const types = useMemo(() => compatibleChartTypes(spec), [spec]);

  const handleExport = useCallback(() => {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(spec.title)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setOpen(false);
  }, [rows, spec.title]);

  const triggerIcon: LucideIcon = view === 'table' ? Table2 : BarChart3;
  const triggerLabel = view === 'table' ? 'Data table' : TYPE_LABEL[activeType];

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid="chart-section-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 28,
          padding: '0 10px',
          background: T.surface,
          border: `1px solid ${T.n200}`,
          borderRadius: 999,
          color: T.n900,
          fontFamily: T.fSans,
          fontSize: 12.5,
          fontWeight: 500,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        <Icon icon={triggerIcon} size={13} color={T.n600} />
        {triggerLabel}
        <Icon icon={ChevronDown} size={13} color={T.n500} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 30,
            minWidth: 180,
            padding: 4,
            background: T.surface,
            border: `1px solid ${T.n200}`,
            borderRadius: 10,
            boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
            fontFamily: T.fSans,
          }}
        >
          {view === 'table' && (
            <MenuItem icon={BarChart3} label="Show chart" onClick={() => { onShowChart(); setOpen(false); }} />
          )}
          {view === 'chart' && types.length > 1 && (
            <>
              <MenuLabel>Chart type</MenuLabel>
              {types.map((t) => (
                <MenuItem
                  key={t}
                  icon={chartTypeIcon(t)}
                  label={TYPE_LABEL[t]}
                  trailing={t === activeType ? <Icon icon={Check} size={13} color={T.brand} /> : null}
                  onClick={() => { onChangeType(t); setOpen(false); }}
                />
              ))}
              <Divider />
            </>
          )}
          {view === 'chart' && (
            <MenuItem icon={Table2} label="Data table" onClick={() => { onShowTable(); setOpen(false); }} />
          )}
          <MenuItem icon={Download} label="Export CSV" onClick={handleExport} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Private bits
// ---------------------------------------------------------------------------

function chartTypeIcon(t: ChartSpec['type']): LucideIcon {
  if (t === 'line' || t === 'multi-line' || t === 'area') return LineChartIcon;
  return BarChart3;
}

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  trailing?: React.ReactNode;
}

function MenuItem({ icon, label, onClick, trailing }: MenuItemProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '6px 10px',
        background: hover ? T.n100 : 'transparent',
        border: 'none',
        borderRadius: 6,
        color: T.n900,
        fontFamily: T.fSans,
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <Icon icon={icon} size={14} color={T.n600} />
      <span style={{ flex: 1 }}>{label}</span>
      {trailing}
    </button>
  );
}

function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '6px 10px 2px',
        fontFamily: T.fSans,
        fontSize: 11,
        fontWeight: 600,
        color: T.n500,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: T.n200, margin: '4px 0' }} />;
}
