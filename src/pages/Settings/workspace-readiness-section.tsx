/**
 * Settings → Workspace readiness. Shows the active workspace's health:
 *   A. Game cube availability (per-game cube count from the workspace meta).
 *   B. Artifact survival counts (dashboards / segments / cube aliases scoped
 *      to this owner+workspace).
 *   C. Registry coverage delta against the workspace's live meta.
 *
 * The panel is read-only and refetches when the workspace switches or the
 * user hits Refresh. Styling matches the coverage tab — same semantic tokens.
 */

import { ReactElement } from 'react';
import styled from 'styled-components';
import { RefreshCw } from 'lucide-react';

import {
  SectionCard,
  SectionHead,
  SectionTitle,
  SectionHint,
} from './section-card';
import { useWorkspaceReadiness, type GameReadiness, type PreaggGame } from './use-workspace-readiness';
import { useWorkspaceContext } from '../../components/workspace-context';
import { ArtifactSweepPanel } from './artifact-sweep-panel';

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
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

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
`;

const Cell = styled.div<{ tone: 'ok' | 'warn' | 'bad' | 'mute' }>`
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  background: ${(p) =>
    p.tone === 'ok'
      ? 'var(--success-soft)'
      : p.tone === 'warn'
      ? 'var(--warning-soft)'
      : p.tone === 'bad'
      ? 'var(--destructive-soft)'
      : 'var(--bg-muted)'};
  color: ${(p) =>
    p.tone === 'ok'
      ? 'var(--success-ink)'
      : p.tone === 'warn'
      ? 'var(--warning-ink)'
      : p.tone === 'bad'
      ? 'var(--destructive-ink)'
      : 'var(--text-secondary)'};

  & .label {
    font-size: 12.5px;
    font-weight: 600;
    margin-bottom: 2px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  & .sub {
    font-size: 11.5px;
    opacity: 0.85;
  }
`;

const StatRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  & > div {
    flex: 1 1 140px;
    border: 1px solid var(--border-card);
    border-radius: var(--radius-md);
    padding: 10px 12px;
    background: var(--bg-card);
  }
  & .v {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  & .k {
    font-size: 11.5px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
`;

const Empty = styled.div`
  font-size: 12.5px;
  color: var(--text-muted);
  padding: 14px;
`;

function gameTone(g: GameReadiness): 'ok' | 'warn' | 'bad' | 'mute' {
  if (g.status === 'ok') return 'ok';
  if (g.status === 'missing') return 'warn';
  return 'bad';
}

/** Tone for a pre-agg game row: errors dominate, then unbuilt, then all-built, then empty. */
function preaggTone(g: PreaggGame): 'ok' | 'warn' | 'bad' | 'mute' {
  if (g.cubes.length === 0) return 'mute';
  if (g.errored > 0) return 'bad';
  if (g.unbuilt > 0) return 'warn';
  return 'ok';
}

export function WorkspaceReadinessSection(): ReactElement {
  const { workspaceId, workspace } = useWorkspaceContext();
  const { report, loading, error, refetch } = useWorkspaceReadiness(workspaceId);

  const totalBrokenRefs =
    report?.coverage.games.reduce((sum, g) => sum + g.brokenRefs.length, 0) ?? 0;
  const totalUncovered =
    report?.coverage.games.reduce((sum, g) => sum + g.uncoveredMeasures.length, 0) ?? 0;
  const coverageErrors =
    report?.coverage.games.filter((g) => g.status === 'error').length ?? 0;

  return (
    <Stack>
      <SectionCard>
        <SectionHead>
          <div>
            <SectionTitle>
              Workspace · {workspace?.label ?? workspaceId ?? '—'}
            </SectionTitle>
            <SectionHint>
              Per-workspace health: which games have cubes, your saved artifact
              counts, and how the shared business-metrics registry reconciles
              against this workspace’s live <code>/meta</code>.
            </SectionHint>
          </div>
          <Btn type="button" onClick={() => void refetch()} disabled={loading || !workspaceId}>
            <RefreshCw size={13} strokeWidth={2} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </Btn>
        </SectionHead>

        {error && (
          <Cell tone="bad">
            <div className="label">Couldn’t load readiness</div>
            <div className="sub">{error}</div>
          </Cell>
        )}

        {!error && !report && !loading && <Empty>Pick a workspace to see readiness.</Empty>}
      </SectionCard>

      {report && (
        <>
          <SectionCard>
            <SectionHead>
              <div>
                <SectionTitle>Game availability</SectionTitle>
                <SectionHint>
                  {workspace?.gameModel === 'prefix'
                    ? 'Cube counts are filtered by the workspace’s prefix map.'
                    : 'Cube counts come from each game’s scoped /meta response.'}
                </SectionHint>
              </div>
            </SectionHead>
            {report.games.length === 0 ? (
              <Empty>No games configured.</Empty>
            ) : (
              <Grid>
                {report.games.map((g) => (
                  <Cell key={g.id} tone={gameTone(g)}>
                    <div className="label">
                      <span>{g.label}</span>
                      <span>{g.status === 'ok' ? `${g.cubeCount} cubes` : g.status === 'missing' ? 'no cubes' : 'error'}</span>
                    </div>
                    <div className="sub">
                      {g.prefix ? `prefix: ${g.prefix}` : `id: ${g.id}`}
                      {g.error ? ` · ${g.error}` : ''}
                    </div>
                  </Cell>
                ))}
              </Grid>
            )}
          </SectionCard>

          <SectionCard>
            <SectionHead>
              <div>
                <SectionTitle>Pre-aggregation status</SectionTitle>
                <SectionHint>
                  {report.workspace.gameModel !== 'game_id'
                    ? 'Pre-agg status is only tracked for the in-stack local workspace.'
                    : 'Built / unbuilt rollup partitions per game. Unbuilt = partition exists but has not been populated yet.'}
                </SectionHint>
              </div>
            </SectionHead>
            {report.workspace.gameModel !== 'game_id' ? (
              <Empty>Pre-agg status is only tracked for the in-stack local workspace.</Empty>
            ) : report.preaggs.games.length === 0 ? (
              <Empty>No games configured.</Empty>
            ) : (
              <Grid>
                {report.preaggs.games.map((g) => {
                  const tone = preaggTone(g);
                  const total = g.built + g.unbuilt + g.errored;
                  const erroredCubes = g.cubes
                    .filter((c) => c.status === 'error')
                    .map((c) => c.cube);
                  return (
                    <Cell key={g.id} tone={tone}>
                      <div className="label">
                        <span>{g.label}</span>
                        <span>{g.built}/{total} built</span>
                      </div>
                      <div className="sub">
                        {g.unbuilt > 0 && `${g.unbuilt} unbuilt`}
                        {g.unbuilt > 0 && erroredCubes.length > 0 && ' · '}
                        {erroredCubes.length > 0 && `err: ${erroredCubes.join(', ')}`}
                        {g.unbuilt === 0 && erroredCubes.length === 0 && 'all built'}
                      </div>
                    </Cell>
                  );
                })}
              </Grid>
            )}
          </SectionCard>

          <SectionCard>
            <SectionHead>
              <div>
                <SectionTitle>Your artifacts in this workspace</SectionTitle>
                <SectionHint>
                  Counts of saved items scoped to your owner + workspace bucket.
                  Switching workspaces hides items from the other side.
                </SectionHint>
              </div>
            </SectionHead>
            <StatRow>
              <div>
                <div className="v">{report.artifacts.dashboards}</div>
                <div className="k">Dashboards</div>
              </div>
              <div>
                <div className="v">{report.artifacts.segments}</div>
                <div className="k">Segments</div>
              </div>
              <div>
                <div className="v">{report.artifacts.cubeAliases}</div>
                <div className="k">Cube aliases</div>
              </div>
            </StatRow>
          </SectionCard>

          <ArtifactSweepPanel
            workspaceId={workspaceId}
            gameModel={report.workspace.gameModel}
          />

          <SectionCard>
            <SectionHead>
              <div>
                <SectionTitle>Registry coverage</SectionTitle>
                <SectionHint>
                  Shared business-metrics registry vs this workspace’s live meta.
                  See <strong>Metric coverage</strong> tab for the full per-game
                  matrix.
                </SectionHint>
              </div>
            </SectionHead>
            <StatRow>
              <div>
                <div className="v">{totalBrokenRefs}</div>
                <div className="k">Broken refs</div>
              </div>
              <div>
                <div className="v">{totalUncovered}</div>
                <div className="k">Uncovered measures</div>
              </div>
              <div>
                <div className="v">{coverageErrors}</div>
                <div className="k">Games errored</div>
              </div>
            </StatRow>
          </SectionCard>
        </>
      )}
    </Stack>
  );
}

export default WorkspaceReadinessSection;
