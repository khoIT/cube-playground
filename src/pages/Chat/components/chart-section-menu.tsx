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
import { ChevronDown, BarChart3, LineChart as LineChartIcon, Table2, Download, Check, Grid3x3 } from 'lucide-react';
import { T, Icon, type LucideIcon } from '../../../shell/theme';
import type { ChartColumn, ChartSpec } from '../../../api/chat-sse-client';
import { labelOf, type LabelMap } from './chart-column-labels';

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
  heatmap: 'Heatmap',
  'dual-axis': 'Bars + line',
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

/** The categorical (label) column — the first non-numeric column, e.g. country. */
function categoryColumn(spec: ChartSpec): string | undefined {
  return Object.keys(spec.data[0] ?? {}).find((c) => !isNumericColumn(spec.data, c));
}

/**
 * "1 category + 2 metrics" data (e.g. country × {arpu, paying_rate}) can render
 * as a dual-axis combo — independent axes let two differently-scaled metrics
 * both read clearly, which a single-axis bar/line can't. Needs a categorical
 * column for the x-axis plus ≥2 numeric columns.
 */
export function canDualAxis(spec: ChartSpec): boolean {
  return !spec.encoding.series && categoryColumn(spec) != null && numericColumns(spec.data).length >= 2;
}

/**
 * Re-encode for the dual-axis combo: x = the entity column, `value` = the first
 * metric (left axis, bars), `series` = the second metric (right axis, line).
 */
export function toDualAxisSpec(spec: ChartSpec): ChartSpec {
  const nums = numericColumns(spec.data);
  const cat = categoryColumn(spec) ?? spec.encoding.category;
  return { ...spec, type: 'dual-axis', encoding: { category: cat, value: nums[0], series: nums[1] } } as ChartSpec;
}

// Two measures whose peaks differ by more than this squash the smaller series
// toward the axis floor on a shared scale — the dual-axis combo becomes the
// better default. 4× ≈ the smaller series capped at a quarter of the axis;
// the real motivating case ("matches per day" ~2M vs "distinct players"
// ~300K) sits at ~6.5×, well past it, while near-peer pairs (kills vs
// deaths) stay single-axis.
const DUAL_AXIS_SCALE_GAP = 4;

/**
 * Should this spec DEFAULT to the dual-axis view? True for single-axis
 * category×value specs carrying two numeric measure columns on visibly
 * different scales. The chart-type menu still lets the user switch back.
 */
export function preferDualAxis(spec: ChartSpec): boolean {
  if (!canDualAxis(spec)) return false;
  // Only single-axis families auto-upgrade; explicit scatter/pie/funnel/
  // heatmap intents (and already-dual specs) are respected as declared.
  if (spec.type !== 'bar' && spec.type !== 'line' && spec.type !== 'area') return false;
  const nums = numericColumns(spec.data);
  // Exactly two measures: the combo can only chart two — auto-upgrading a
  // 3+-measure result would silently drop series (menu still offers it).
  if (nums.length !== 2) return false;
  const [a, b] = nums;
  const peak = (col: string) =>
    spec.data.reduce((m, r) => Math.max(m, Math.abs(Number(r[col]) || 0)), 0);
  const [pa, pb] = [peak(a), peak(b)];
  if (pa === 0 || pb === 0) return false;
  return Math.max(pa, pb) / Math.min(pa, pb) > DUAL_AXIS_SCALE_GAP;
}

/**
 * Every chart type that can sensibly render this spec's data shape — drives the
 * "switch chart type" menu so the user can explore all valid views of a table.
 *
 * - series-encoded (category + value + series): the multi-series families.
 * - funnel is a distinct intent that doesn't interchange, so it stays isolated.
 * - scatter and category×value both gain scatter + dual-axis when the rows
 *   carry a categorical column and ≥2 numeric columns (two metrics per entity):
 *   scatter for correlation, dual-axis (bars + line) for magnitude on two scales.
 * - otherwise category×value: the single-series set, plus pie/donut when there
 *   are few enough slices to read.
 */
export function compatibleChartTypes(spec: ChartSpec): ChartSpec['type'][] {
  // Series-encoded (category + value + series) data is exactly the heatmap
  // shape too (x × y grid), so the families interchange.
  if (spec.encoding.series) return ['grouped-bar', 'stacked-bar', 'multi-line', 'heatmap'];
  if (spec.type === 'funnel') return ['funnel'];

  if (spec.type === 'scatter') {
    return canDualAxis(spec) ? ['scatter', 'dual-axis'] : ['scatter'];
  }

  const types: ChartSpec['type'][] = ['bar', 'horizontal-bar', 'line', 'area'];
  if (spec.data.length >= 1 && spec.data.length <= PIE_MAX_SLICES) {
    types.push('pie', 'donut');
  }
  if (numericColumns(spec.data).length >= 2) {
    types.push('scatter');
  }
  if (canDualAxis(spec)) {
    types.push('dual-axis');
  }
  return types;
}

/**
 * Default to the table (not the chart) for table-shaped results — a
 * high-cardinality entity leaderboard (e.g. 100 users) or a wide multi-column
 * result reads as a table, and a single-series bar of it is noise. Small
 * categorical results stay chart-first.
 */
export function preferTableView(spec: ChartSpec): boolean {
  // Heatmaps are grids — one row per (x, y) cell routinely exceeds the
  // leaderboard threshold, but the chart is the readable view.
  if (spec.type === 'heatmap') return false;
  const columnCount = Object.keys(spec.data[0] ?? {}).length;
  return spec.data.length > 12 || columnCount >= 4;
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
  /** Column descriptors — when present, the menu shows an X/Y/Series axis picker. */
  columns?: ChartColumn[];
  /** Member-ref → label map for the axis-picker option text. */
  labels?: LabelMap;
  /** Encoding currently rendered (so the picker reflects the active axes). */
  activeEncoding?: ChartSpec['encoding'];
  /** Apply a user-chosen encoding (X/Y/optional series). */
  onChangeEncoding?: (encoding: ChartSpec['encoding']) => void;
}

export function ChartSectionMenu({
  spec,
  view,
  activeType,
  rows,
  onShowChart,
  onShowTable,
  onChangeType,
  columns,
  labels = {},
  activeEncoding,
  onChangeEncoding,
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
          {view === 'chart' && columns && columns.length > 0 && onChangeEncoding && (
            <>
              <MenuLabel>Axes</MenuLabel>
              <AxisPicker
                columns={columns}
                labels={labels}
                encoding={activeEncoding ?? spec.encoding}
                onChange={onChangeEncoding}
              />
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
  if (t === 'heatmap') return Grid3x3;
  return BarChart3;
}

// ---------------------------------------------------------------------------
// AxisPicker — choose which columns map to X / Y (/ optional series). Lets the
// user re-chart any two columns of the result table without leaving the card.
// Y is restricted to numeric columns; series to non-numeric (grouping) columns.
// ---------------------------------------------------------------------------

interface AxisPickerProps {
  columns: ChartColumn[];
  labels: LabelMap;
  encoding: ChartSpec['encoding'];
  onChange: (encoding: ChartSpec['encoding']) => void;
}

function AxisPicker({ columns, labels, encoding, onChange }: AxisPickerProps) {
  const numeric = columns.filter((c) => c.dataType === 'number');
  const categorical = columns.filter((c) => c.dataType !== 'number');

  return (
    <div style={{ padding: '2px 10px 6px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <AxisSelect
        label="X"
        value={encoding.category}
        options={columns}
        labels={labels}
        onChange={(v) => onChange({ ...encoding, category: v })}
      />
      <AxisSelect
        label="Y"
        value={encoding.value}
        options={numeric.length > 0 ? numeric : columns}
        labels={labels}
        onChange={(v) => onChange({ ...encoding, value: v })}
      />
      <AxisSelect
        label="Series"
        value={encoding.series ?? ''}
        options={categorical}
        labels={labels}
        allowNone
        onChange={(v) => {
          const next = { ...encoding };
          if (v) next.series = v;
          else delete next.series;
          onChange(next);
        }}
      />
    </div>
  );
}

interface AxisSelectProps {
  label: string;
  value: string;
  options: ChartColumn[];
  labels: LabelMap;
  allowNone?: boolean;
  onChange: (value: string) => void;
}

function AxisSelect({ label, value, options, labels, allowNone, onChange }: AxisSelectProps) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: T.fSans, fontSize: 12.5 }}>
      <span style={{ width: 46, color: T.n500, flexShrink: 0 }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          minWidth: 0,
          height: 26,
          padding: '0 6px',
          background: T.surface,
          border: `1px solid ${T.n200}`,
          borderRadius: 6,
          color: T.n900,
          fontFamily: T.fSans,
          fontSize: 12.5,
          cursor: 'pointer',
        }}
      >
        {allowNone && <option value="">None</option>}
        {options.map((c) => (
          <option key={c.key} value={c.key}>
            {labelOf(labels, c.key)}
          </option>
        ))}
      </select>
    </label>
  );
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
