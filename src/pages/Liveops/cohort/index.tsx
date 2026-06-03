/**
 * CohortRetentionPage — /liveops/cohort
 *
 * Day-N retention heatmap for the active game. Rows = daily cohorts
 * (users whose first active day = that date). Columns = D1, D3, D7, D14, D30.
 *
 * Data path badge:
 *   Green  "Server-side retention"       — single Cube query against retention cube.
 *   Amber  "Client-side compute (≤28d)"  — pivoted from active_daily rows.
 *
 * Retention definition (surfaced in header tooltip):
 *   A user belongs to the cohort of the FIRST day they appear in active_daily.
 *   DX retention = fraction of that cohort who were also active on day X after
 *   their first day. This matches a "daily-active re-appearance" definition,
 *   not a strict install event. When a server-side retention cube is deployed
 *   (see docs/cohort-retention-cube-template.md) the definition can be refined
 *   to use actual install events.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameContext } from '../../../components/Header/use-game-context';
import { useCohortGrid } from './use-cohort-grid';
import { CohortGrid } from './cohort-grid';
import { downloadCohortCsv } from './export-cohort-csv';
import { recordExport } from '../../../api/feature-open-beacon';
import type { CohortWindow } from './use-cohort-grid';
import type { CsvMode } from './export-cohort-csv';

// ── Window selector options ──────────────────────────────────────────────────

const WINDOW_OPTIONS: CohortWindow[] = [7, 14, 28];

// ── Inline badge component ───────────────────────────────────────────────────

function DataPathBadge({ path }: { path: 'server' | 'client' | 'detecting' }) {
  if (path === 'detecting') {
    return (
      <span style={badgeStyle('var(--bg-muted)', 'var(--text-muted)')}>
        Detecting…
      </span>
    );
  }
  if (path === 'server') {
    return (
      <span style={badgeStyle('var(--success-soft)', 'var(--success-ink)')}>
        Server-side retention
      </span>
    );
  }
  return (
    <span
      style={badgeStyle('var(--warning-soft)', 'var(--warning-ink)')}
      title="Window capped at 28 days in client-side compute mode. Deploy the server-side retention cube (docs/cohort-retention-cube-template.md) to unlock larger windows."
    >
      Client-side compute (≤28d only)
    </span>
  );
}

function badgeStyle(bg: string, color: string): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 600,
    background: bg,
    color,
    borderRadius: 'var(--radius-full)',
    padding: '2px 8px',
    whiteSpace: 'nowrap',
    cursor: 'default',
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function CohortRetentionPage() {
  const { gameId } = useGameContext();
  const [cohortWindow, setCohortWindow] = useState<CohortWindow>(14);
  const [csvMode, setCsvMode] = useState<CsvMode>('percent');

  const { rows, status, error, dataPath } = useCohortGrid(gameId, cohortWindow);

  const handleExport = () => {
    downloadCohortCsv(rows, csvMode, gameId);
    recordExport('cohort-csv', gameId);
  };
  const toggleCsvMode = () =>
    setCsvMode((m) => (m === 'percent' ? 'counts' : 'percent'));

  return (
    <div style={{ padding: '24px 20px', maxWidth: 960 }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        <Link to="/liveops" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          Liveops
        </Link>
        {' / Cohort retention'}
      </div>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              Cohort retention
            </h2>
            <DataPathBadge path={dataPath} />
            {/* Info tooltip trigger */}
            <span
              title={
                'Retention definition: a user\'s cohort = their FIRST active day in the window.\n' +
                'DX = fraction of that cohort active on day X after first appearance.\n\n' +
                'D30 columns near recent cohorts are not yet mature (striped pattern).\n\n' +
                'Client-side mode: data is computed from active_daily rows — heavy for large\n' +
                'user bases. Deploy the server-side retention cube to improve performance.\n' +
                'See docs/cohort-retention-cube-template.md for setup instructions.'
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: 'var(--bg-muted)',
                border: '1px solid var(--border-card)',
                color: 'var(--text-muted)',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'help',
                flexShrink: 0,
              }}
            >
              ?
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            Day-N re-appearance retention for game <strong>{gameId}</strong>.
            Striped cells = cohort not yet old enough to be measured.
          </p>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Window selector */}
          <div style={{ display: 'flex', gap: 2 }}>
            {WINDOW_OPTIONS.map((w) => (
              <button
                key={w}
                onClick={() => setCohortWindow(w)}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 500,
                  border: '1px solid var(--border-card)',
                  borderRadius: 'var(--radius-sm)',
                  background: cohortWindow === w ? 'var(--brand)' : 'var(--bg-card)',
                  color: cohortWindow === w ? '#fff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
              >
                {w}d
              </button>
            ))}
          </div>

          {/* CSV mode toggle */}
          <button
            onClick={toggleCsvMode}
            style={secondaryButtonStyle}
            title="Toggle between exporting percentages and raw counts"
          >
            {csvMode === 'percent' ? 'Export %' : 'Export counts'}
          </button>

          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={rows.length === 0}
            style={{
              ...secondaryButtonStyle,
              opacity: rows.length === 0 ? 0.5 : 1,
              cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Download CSV
          </button>
        </div>
      </div>

      {/* States */}
      {status === 'loading' && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {dataPath === 'detecting' ? 'Detecting data path…' : 'Loading cohort data…'}
        </p>
      )}

      {status === 'error' && (
        <div style={errorBoxStyle}>
          Failed to load cohort data: {error}
        </div>
      )}

      {status === 'success' && rows.length === 0 && (
        <div style={emptyBoxStyle}>
          No cohort data for the last {cohortWindow} days.
          <br />
          <span style={{ fontSize: 11 }}>
            Ensure the active_daily cube is populated for game <strong>{gameId}</strong>.
          </span>
        </div>
      )}

      {status === 'success' && rows.length > 0 && (
        <CohortGrid rows={rows} />
      )}

      {/* Legend */}
      <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span>
          Color scale: relative to column max (darkest = highest retention in column).
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 12, height: 12, background: 'repeating-linear-gradient(135deg,#e5e7eb 0,#e5e7eb 2px,#f9fafb 2px,#f9fafb 8px)', verticalAlign: 'middle', marginRight: 4 }} />
          Striped = not yet mature.
        </span>
      </div>
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────────────────────────

const secondaryButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 500,
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-card)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};

const errorBoxStyle: React.CSSProperties = {
  padding: 16,
  background: 'var(--destructive-soft)',
  color: 'var(--destructive-ink)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
};

const emptyBoxStyle: React.CSSProperties = {
  padding: 32,
  textAlign: 'center',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  color: 'var(--text-muted)',
  fontSize: 13,
};
