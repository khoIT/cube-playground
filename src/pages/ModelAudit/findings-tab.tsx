/**
 * Findings tab — the all-games heatmap landing view. Reads the selected run's
 * cube grid + findings, applies severity/dimension filters to cell coloring,
 * and opens a per-cell detail drawer. "View diff" hands off to the Diffs tab.
 */

import React, { useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useModelAuditContext } from './model-audit-context';
import { useRunDetail, useRunFindings } from './use-model-audit-api';
import { FindingsHeatmap } from './findings-heatmap';
import { FindingDetailDrawer, type DrawerSelection } from './finding-detail-drawer';
import type { ParityFinding } from './model-audit-types';

const ALL = '__all__';

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
          padding: '4px 8px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-card)',
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
        }}
      >
        <option value={ALL}>All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

const LEGEND: Array<[string, string]> = [
  ['Correctness', 'var(--destructive-soft)'],
  ['Parity', 'var(--warning-soft)'],
  ['Cosmetic', 'var(--info-soft)'],
  ['Clean', 'var(--success-soft)'],
];

export function FindingsTab() {
  const { selectedRunId } = useModelAuditContext();
  const detail = useRunDetail(selectedRunId);
  const findingsState = useRunFindings(selectedRunId);
  const history = useHistory();

  const [sevFilter, setSevFilter] = useState<string>(ALL);
  const [dimFilter, setDimFilter] = useState<string>(ALL);
  const [selection, setSelection] = useState<DrawerSelection | null>(null);

  const allFindings: ParityFinding[] = findingsState.data?.findings ?? [];
  const dimensions = useMemo(() => [...new Set(allFindings.map((f) => f.dimension))].sort(), [allFindings]);

  const filtered = useMemo(
    () =>
      allFindings.filter(
        (f) => (sevFilter === ALL || f.severity === sevFilter) && (dimFilter === ALL || f.dimension === dimFilter),
      ),
    [allFindings, sevFilter, dimFilter],
  );

  const cubes = detail.data?.cubes ?? [];
  const games = useMemo(() => {
    const fromRun = detail.data?.run.games ?? [];
    const fromCubes = [...new Set(cubes.map((c) => c.game))];
    return [...new Set([...fromRun, ...fromCubes])].sort();
  }, [detail.data, cubes]);

  const openCell = (game: string, cube: string) => {
    const cellFindings = allFindings.filter((f) => f.game === game && f.cube === cube);
    const rc = cubes.find((c) => c.game === game && c.cube === cube);
    setSelection({ game, cube, hasProd: rc?.hasProd ?? false, findings: cellFindings });
  };

  const viewDiff = (game: string, cube: string) => {
    setSelection(null);
    history.push(`/model-audit/diffs?game=${encodeURIComponent(game)}&cube=${encodeURIComponent(cube)}`);
  };

  if (detail.isLoading || findingsState.isLoading) {
    return <div style={muted}>Loading run…</div>;
  }
  if (detail.error || findingsState.error) {
    return <div style={errorStyle}>Failed to load: {detail.error ?? findingsState.error}</div>;
  }
  if (!detail.data) {
    return <div style={muted}>No audit run recorded yet — click “Run audit now”.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <FilterSelect label="Severity" value={sevFilter} options={['correctness', 'parity', 'cosmetic']} onChange={setSevFilter} />
        <FilterSelect label="Dimension" value={dimFilter} options={dimensions} onChange={setDimFilter} />
        <div style={{ display: 'flex', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {LEGEND.map(([label, soft]) => (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: soft, border: '1px solid var(--border-card)' }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <FindingsHeatmap games={games} cubes={cubes} findings={filtered} onCellClick={openCell} />

      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>
        {filtered.length} finding(s) shown · cell number = open findings · ✓ clean · hatched = no oracle counterpart · “·” = not modeled
      </div>

      <FindingDetailDrawer selection={selection} onClose={() => setSelection(null)} onViewDiff={viewDiff} />
    </div>
  );
}

const muted: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)', padding: '24px 0' };
const errorStyle: React.CSSProperties = { fontSize: 13, color: 'var(--destructive-ink)', padding: '24px 0' };
