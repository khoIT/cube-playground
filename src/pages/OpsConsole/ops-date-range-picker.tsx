/**
 * Custom date-range picker for the Ops Console — sits beside the 7d/30d/MTD
 * toggle. Enforces the same ≤31-day span the presets respect (billing_detail
 * full-scans otherwise): spans over the cap are blocked with an inline message
 * and a disabled Apply — never silently clamped, so the limit is visible.
 *
 * Defaults to the last 7 days ending "today" in GMT+7 (Asia/Saigon), since the
 * data + the team are on that calendar. Ranges are stored/emitted as inclusive
 * YYYY-MM-DD strings (Cube `dateRange` convention).
 */
import React from 'react';
import { CalendarRange } from 'lucide-react';
import { isRangeWithinCap, rangeDaysInclusive, OPS_RANGE_MAX_DAYS, type OpsRange } from './ops-window';

/** Today as a YYYY-MM-DD calendar date in GMT+7 (not UTC). */
function todayInSaigon(): string {
  // en-CA renders ISO-style YYYY-MM-DD; the timeZone option does the GMT+7 shift.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Saigon' });
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 12,
  fontFamily: 'var(--font-sans)',
  color: 'var(--text-primary)',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-md)',
  outline: 'none',
};

interface OpsDateRangePickerProps {
  value: OpsRange | null;
  /** True when the custom range is the active window (highlights the control). */
  active: boolean;
  onApply: (range: OpsRange) => void;
}

export function OpsDateRangePicker({ value, active, onApply }: OpsDateRangePickerProps) {
  const today = todayInSaigon();
  const [start, setStart] = React.useState(value?.start ?? addDays(today, -6));
  const [end, setEnd] = React.useState(value?.end ?? today);

  const valid = isRangeWithinCap(start, end);
  const days = start && end ? rangeDaysInclusive(start, end) : 0;
  const hint =
    !start || !end
      ? 'Pick a start and end date'
      : days < 1
        ? 'End must be on or after start'
        : days > OPS_RANGE_MAX_DAYS
          ? `Max ${OPS_RANGE_MAX_DAYS} days (selected ${days})`
          : null;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        background: active ? 'var(--brand-soft)' : 'var(--bg-card)',
        border: `1px solid ${active ? 'var(--brand)' : 'var(--border-card)'}`,
        borderRadius: 'var(--radius-full)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <CalendarRange size={14} color={active ? 'var(--brand)' : 'var(--text-muted)'} />
      <input
        type="date"
        aria-label="Start date"
        value={start}
        max={end || today}
        onChange={(e) => setStart(e.target.value)}
        style={inputStyle}
      />
      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
      <input
        type="date"
        aria-label="End date"
        value={end}
        min={start}
        max={today}
        onChange={(e) => setEnd(e.target.value)}
        style={inputStyle}
      />
      <button
        type="button"
        disabled={!valid}
        onClick={() => valid && onApply({ start, end })}
        title={hint ?? `Apply ${days}-day range`}
        style={{
          padding: '5px 12px',
          border: 'none',
          borderRadius: 'var(--radius-full)',
          fontSize: 12,
          fontWeight: 600,
          cursor: valid ? 'pointer' : 'not-allowed',
          fontFamily: 'var(--font-sans)',
          background: valid ? 'var(--brand)' : 'var(--bg-muted)',
          color: valid ? 'var(--text-on-brand)' : 'var(--text-muted)',
        }}
      >
        Apply
      </button>
      {hint && (
        <span style={{ fontSize: 10.5, color: 'var(--warning-ink)', fontWeight: 600 }}>{hint}</span>
      )}
    </div>
  );
}
