/**
 * Admin → Dev → Data coverage. Per-game Member 360 readiness across the
 * Trino → Cube YAML → product-config chain, for the active workspace.
 *
 *   • Matrix: rows = games with a 360 config, cols = the 360 surfaces (views).
 *     Each cell is a status dot (ready / partial / empty / blocked) — click to
 *     inspect.
 *   • Resolve pane: the selected cell's three gated layers as a dot-stepper,
 *     so an operator can see WHICH layer blocks (no Trino data vs. unmodeled
 *     view vs. missing members) and what to do next.
 *
 * Read-only diagnosis. Authoring the missing Cube model (the "scaffold draft"
 * action) is the separate onboarding-agent flow — surfaced here as a next-step,
 * not performed inline (no silent YAML mutation from this panel).
 *
 * Tokens only; mirrors workspace-readiness-section styling.
 */

import { Fragment, ReactElement, useMemo, useState } from 'react';
import styled from 'styled-components';
import { RefreshCw } from 'lucide-react';

import {
  SectionCard,
  SectionHead,
  SectionTitle,
  SectionHint,
} from '../../Settings/section-card';
import { useWorkspaceContext } from '../../../components/workspace-context';
import {
  useMember360Coverage,
  type GameCoverage,
  type PanelCoverage,
  type PanelCoverageStatus,
  type GameCoverageStatus,
} from '../../../hooks/use-member360-coverage';

// --- status → tone --------------------------------------------------------

type Tone = 'ready' | 'partial' | 'empty' | 'blocked' | 'na' | 'error';

const TONE: Record<Tone, { soft: string; ink: string; label: string }> = {
  ready: { soft: 'var(--success-soft)', ink: 'var(--success-ink)', label: 'Ready' },
  partial: { soft: 'var(--warning-soft)', ink: 'var(--warning-ink)', label: 'Partial' },
  empty: { soft: 'var(--info-soft)', ink: 'var(--info-ink)', label: 'No data' },
  blocked: { soft: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'Blocked' },
  error: { soft: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'Error' },
  na: { soft: 'var(--bg-muted)', ink: 'var(--text-muted)', label: 'N/A' },
};

const asTone = (s: PanelCoverageStatus | GameCoverageStatus | 'error'): Tone =>
  (s in TONE ? (s as Tone) : 'na');

// --- styled ---------------------------------------------------------------

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 16px;
`;

const Btn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  &:hover:not(:disabled) { color: var(--brand); border-color: var(--brand); background: var(--brand-soft); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const Empty = styled.div`
  font-size: 12.5px;
  color: var(--text-muted);
  padding: 14px;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-family: var(--font-sans);
  font-size: 12.5px;

  th, td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-card);
    text-align: left;
    white-space: nowrap;
  }
  th {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  td.game { font-weight: 600; color: var(--text-primary); }
`;

const Pill = styled.button<{ tone: Tone; selected: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 9px;
  border-radius: var(--radius-pill);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  background: ${(p) => TONE[p.tone].soft};
  color: ${(p) => TONE[p.tone].ink};
  border: 1px solid ${(p) => (p.selected ? 'var(--brand)' : 'transparent')};
  font-family: var(--font-sans);
  &:hover { border-color: var(--brand); }
`;

const Dot = styled.span<{ tone: Tone }>`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${(p) => TONE[p.tone].ink};
  flex-shrink: 0;
`;

// --- layer stepper --------------------------------------------------------

const Chain = styled.div`
  display: flex;
  align-items: stretch;
  gap: 0;
  margin: 12px 0;
`;

const Step = styled.div<{ tone: Tone }>`
  flex: 1;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  background: ${(p) => TONE[p.tone].soft};
  color: ${(p) => TONE[p.tone].ink};
  & .layer { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.8; }
  & .state { font-size: 12.5px; font-weight: 600; display: flex; align-items: center; gap: 6px; margin-top: 3px; }
  & .note { font-size: 11px; opacity: 0.9; margin-top: 4px; white-space: normal; }
`;

const Arrow = styled.div`
  align-self: center;
  padding: 0 8px;
  color: var(--text-muted);
  font-size: 14px;
`;

// Map a panel status to the three gated layers (Trino → Cube YAML → Product).
function chainFor(p: PanelCoverage): Array<{ layer: string; tone: Tone; state: string; note?: string }> {
  if (p.status === 'blocked') {
    return [
      { layer: 'Trino', tone: 'na', state: 'Unknown', note: 'View not modeled — table state not probed.' },
      { layer: 'Cube model', tone: 'blocked', state: 'Missing', note: `No "${p.view}" view in /meta. Needs views/<game>/user_360.yml.` },
      { layer: 'Product', tone: 'na', state: 'Waiting' },
    ];
  }
  if (p.status === 'partial') {
    return [
      { layer: 'Trino', tone: 'na', state: 'Unknown', note: 'Not probed until the view is fully modeled.' },
      { layer: 'Cube model', tone: 'partial', state: `Incomplete (${p.modeledMembers}/${p.totalMembers})`, note: `Missing: ${p.missingMembers.join(', ')}` },
      { layer: 'Product', tone: 'partial', state: 'Degraded', note: 'Panel renders; missing fields hidden.' },
    ];
  }
  if (p.status === 'empty') {
    return [
      { layer: 'Trino', tone: 'empty', state: 'No rows', note: 'View modeled but the source table returned no data.' },
      { layer: 'Cube model', tone: 'ready', state: 'Modeled' },
      { layer: 'Product', tone: 'ready', state: 'Wired' },
    ];
  }
  if (p.status === 'error') {
    return [
      { layer: 'Trino', tone: 'error', state: 'Probe failed', note: p.error },
      { layer: 'Cube model', tone: 'ready', state: 'Modeled' },
      { layer: 'Product', tone: 'na', state: '—' },
    ];
  }
  return [
    { layer: 'Trino', tone: 'ready', state: 'Has data' },
    { layer: 'Cube model', tone: 'ready', state: 'Modeled' },
    { layer: 'Product', tone: 'ready', state: 'Live' },
  ];
}

// --- component -------------------------------------------------------------

interface Selection { game: string; view: string; }

export function Member360CoveragePanel(): ReactElement {
  const { workspaceId, workspace } = useWorkspaceContext();
  const { report, loading, error, refetch } = useMember360Coverage(workspaceId);
  const [sel, setSel] = useState<Selection | null>(null);

  // Configured games + the union of their 360 surfaces, ordered by first sight.
  const games = useMemo(
    () => report?.games.filter((g) => g.has360Config) ?? [],
    [report],
  );
  const cols = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of games) for (const p of g.panels) if (!seen.has(p.view)) seen.set(p.view, p.title);
    return [...seen.entries()].map(([view, title]) => ({ view, title }));
  }, [games]);

  const selectedPanel: { game: GameCoverage; panel: PanelCoverage } | null = useMemo(() => {
    if (!sel) return null;
    const g = games.find((x) => x.game === sel.game);
    const p = g?.panels.find((x) => x.view === sel.view);
    return g && p ? { game: g, panel: p } : null;
  }, [sel, games]);

  return (
    <Stack>
      <SectionCard>
        <SectionHead>
          <div>
            <SectionTitle>Member 360 · data coverage</SectionTitle>
            <SectionHint>
              Which 360 surfaces compute today vs. which are blocked pending more
              data or modeling — across the Trino → Cube YAML → product chain, for{' '}
              <strong>{workspace?.label ?? workspaceId ?? '—'}</strong>. Click a
              cell to see which layer blocks.
            </SectionHint>
          </div>
          <Btn type="button" onClick={() => void refetch()} disabled={loading || !workspaceId}>
            <RefreshCw size={13} strokeWidth={2} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </Btn>
        </SectionHead>

        {error && <Empty style={{ color: 'var(--destructive-ink)' }}>Couldn’t load coverage: {error}</Empty>}
        {report?.prefixUnsupported && (
          <Empty>
            This is a <strong>prefix</strong> workspace (upstream model). Member 360
            coverage isn’t evaluated here yet — the prefixed 360 views must be
            exposed upstream. Switch to the local workspace to inspect coverage.
          </Empty>
        )}
        {!error && !report?.prefixUnsupported && games.length === 0 && !loading && (
          <Empty>No games have a Member 360 configuration in this workspace.</Empty>
        )}

        {!report?.prefixUnsupported && games.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <th>Game</th>
                  {cols.map((c) => (
                    <th key={c.view} title={c.view}>{c.title}</th>
                  ))}
                  <th>Overall</th>
                </tr>
              </thead>
              <tbody>
                {games.map((g) => {
                  const byView = new Map(g.panels.map((p) => [p.view, p]));
                  return (
                    <tr key={g.game}>
                      <td className="game">{g.label}</td>
                      {cols.map((c) => {
                        const p = byView.get(c.view);
                        if (!p) return <td key={c.view} style={{ color: 'var(--text-muted)' }}>—</td>;
                        const tone = asTone(p.status);
                        const selected = sel?.game === g.game && sel?.view === c.view;
                        return (
                          <td key={c.view}>
                            <Pill
                              tone={tone}
                              selected={selected}
                              type="button"
                              onClick={() => setSel({ game: g.game, view: c.view })}
                              title={`${p.title}: ${TONE[tone].label}`}
                            >
                              <Dot tone={tone} />
                              {TONE[tone].label}
                            </Pill>
                          </td>
                        );
                      })}
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: TONE[asTone(g.status)].ink, fontWeight: 600 }}>
                          <Dot tone={asTone(g.status)} />
                          {TONE[asTone(g.status)].label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </SectionCard>

      {selectedPanel && (
        <SectionCard>
          <SectionHead>
            <div>
              <SectionTitle>
                {selectedPanel.game.label} · {selectedPanel.panel.title}
              </SectionTitle>
              <SectionHint>
                <code>{selectedPanel.panel.view}</code> — {selectedPanel.panel.modeledMembers}/
                {selectedPanel.panel.totalMembers} members modeled
                {selectedPanel.panel.hasRows === false ? ' · source has no rows' : ''}
              </SectionHint>
            </div>
          </SectionHead>
          <Chain>
            {chainFor(selectedPanel.panel).map((step, i, arr) => (
              <Fragment key={step.layer}>
                <Step tone={step.tone}>
                  <div className="layer">{step.layer}</div>
                  <div className="state"><Dot tone={step.tone} />{step.state}</div>
                  {step.note && <div className="note">{step.note}</div>}
                </Step>
                {i < arr.length - 1 && <Arrow>→</Arrow>}
              </Fragment>
            ))}
          </Chain>
          {(selectedPanel.panel.status === 'blocked' || selectedPanel.panel.status === 'partial') && (
            <SectionHint>
              Next step: author / extend{' '}
              <code>views/{selectedPanel.game.game}/user_360.yml</code> (and any
              missing base cube members) so the view resolves in <code>/meta</code>.
              Scaffolding a draft model is handled by the onboarding flow.
            </SectionHint>
          )}
        </SectionCard>
      )}
    </Stack>
  );
}

export default Member360CoveragePanel;
