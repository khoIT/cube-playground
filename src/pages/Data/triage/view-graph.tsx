/**
 * Triage view B (entity graph): hand-rolled SVG model canvas — one node box per
 * cube with its fields, dashed edges for joins, low-confidence rows highlighted
 * and clickable to resolve. Right column lists open decisions + the shared YAML
 * pane. Deterministic grid layout (no physics) keeps it simple and robust; if a
 * draft has no cubes we render a labeled fallback but still wire the decisions.
 * Thin renderer over useOnboardingDraft.
 */
import { ReactElement } from 'react';
import styled from 'styled-components';
import { Network, AlertTriangle } from 'lucide-react';
import type { InferredCube, InferredField } from '../../../api/onboarding-client';
import type { UseOnboardingDraftResult } from '../use-onboarding-draft';
import { AskAgentBox } from './ask-agent-box';
import { CrossSourceLinksPanel } from './cross-source-links-panel';
import { ConfidencePill, YamlPane, TriageActionBar, pct, rationaleTitle, summariseValidation } from './triage-shared';

const Grid = styled.div`
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 18px;
  align-items: start;
  @media (max-width: 920px) {
    grid-template-columns: 1fr;
  }
`;
const Col = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;
const Canvas = styled.section`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  overflow: hidden;
`;
const CanvasHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-card);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
`;
const ColHead = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
`;
const DecRow = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  cursor: pointer;
  font-family: var(--font-sans);
  &:hover {
    border-color: var(--brand);
  }
`;
const DecTitle = styled.span`
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
`;
const Fallback = styled.div`
  padding: 40px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
`;

// ── SVG layout constants ──────────────────────────────────────────────────────
const NODE_W = 190;
const ROW_H = 26;
const HEADER_H = 30;
const NODE_GAP_X = 80;
const NODE_GAP_Y = 40;
const PAD = 24;
const MAX_FIELDS = 6;

interface Placed {
  cube: InferredCube;
  x: number;
  y: number;
  h: number;
}

function isLow(f: InferredField): boolean {
  return f.role !== 'primary_key' && f.confidence < 0.8;
}

function nodeHeight(cube: InferredCube): number {
  return HEADER_H + Math.min(cube.fields.length, MAX_FIELDS) * ROW_H + 8;
}

interface Props {
  state: UseOnboardingDraftResult;
  canWrite: boolean;
}

export function ViewGraph({ state, canWrite }: Props): ReactElement {
  const cubes = state.draft?.inference?.cubes ?? [];

  // Deterministic 2-column zig-zag layout — robust, no physics, no overlap.
  const placed: Placed[] = [];
  const colY = [PAD, PAD];
  cubes.forEach((cube, i) => {
    const col = i % 2;
    const x = PAD + col * (NODE_W + NODE_GAP_X);
    const y = colY[col];
    const h = nodeHeight(cube);
    placed.push({ cube, x, y, h });
    colY[col] = y + h + NODE_GAP_Y;
  });
  const svgW = PAD * 2 + NODE_W * 2 + NODE_GAP_X;
  const svgH = Math.max(...colY, 200);

  const byName = new Map(placed.map((p) => [p.cube.name, p]));

  const open = state.decisions.filter((d) => d.state === 'open');

  const { label: validationLabel, ok: validationOk } = summariseValidation(state.validation);

  function resolveById(id: string) {
    if (!canWrite) return;
    state.resolve(id, 'accepted');
  }

  return (
    <Grid>
      <Col>
        <Canvas>
          <CanvasHead>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Network size={15} style={{ color: 'var(--brand)' }} aria-hidden /> Model canvas
            </span>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>
              click ⚠ rows to resolve
            </span>
          </CanvasHead>

          {placed.length === 0 ? (
            <Fallback>No cubes inferred yet — generate a draft to populate the canvas.</Fallback>
          ) : (
            <div style={{ overflow: 'auto' }}>
              <svg width={svgW} height={svgH} role="img" aria-label="Entity graph of inferred cubes" style={{ display: 'block' }}>
                {/* edges first so nodes sit on top */}
                {placed.flatMap((p) =>
                  p.cube.joins.map((j) => {
                    const target = byName.get(j.toCube);
                    if (!target) return null;
                    const x1 = p.x + NODE_W;
                    const y1 = p.y + HEADER_H / 2 + 6;
                    const x2 = target.x;
                    const y2 = target.y + HEADER_H / 2 + 6;
                    const midX = (x1 + x2) / 2;
                    const low = j.confidence < 0.8;
                    return (
                      <g key={`${p.cube.name}-${j.toCube}`}>
                        <path
                          d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                          fill="none"
                          stroke={low ? 'var(--warning-ink)' : 'var(--border-strong)'}
                          strokeWidth={1.5}
                          strokeDasharray={low ? '5 4' : undefined}
                        />
                        <text
                          x={midX}
                          y={(y1 + y2) / 2 - 5}
                          textAnchor="middle"
                          fontSize={10}
                          fontFamily="var(--font-sans)"
                          fill="var(--text-muted)"
                        >
                          join {pct(j.confidence)}
                        </text>
                      </g>
                    );
                  }),
                )}

                {placed.map((p) => {
                  const fields = p.cube.fields.slice(0, MAX_FIELDS);
                  return (
                    <g key={p.cube.name}>
                      <rect
                        x={p.x}
                        y={p.y}
                        width={NODE_W}
                        height={p.h}
                        rx={8}
                        fill="var(--bg-card)"
                        stroke="var(--border-card)"
                        strokeWidth={1}
                      />
                      <rect x={p.x} y={p.y} width={NODE_W} height={HEADER_H} rx={8} fill="var(--bg-muted)" />
                      <text
                        x={p.x + 12}
                        y={p.y + 20}
                        fontSize={12}
                        fontWeight={700}
                        fontFamily="var(--font-mono, monospace)"
                        fill="var(--text-primary)"
                      >
                        {p.cube.name}
                      </text>
                      {fields.map((f, fi) => {
                        const ry = p.y + HEADER_H + fi * ROW_H;
                        const low = isLow(f);
                        return (
                          <g
                            key={f.column}
                            style={{ cursor: low && canWrite ? 'pointer' : 'default' }}
                            onClick={() => {
                              if (!low) return;
                              resolveById(`${p.cube.name}.${f.column}`);
                            }}
                          >
                            {low ? (
                              <rect x={p.x + 4} y={ry + 3} width={NODE_W - 8} height={ROW_H - 4} rx={4} fill="var(--warning-soft)" />
                            ) : null}
                            <text
                              x={p.x + 12}
                              y={ry + 17}
                              fontSize={11.5}
                              fontFamily="var(--font-mono, monospace)"
                              fill={low ? 'var(--warning-ink)' : 'var(--text-secondary)'}
                            >
                              {low ? '⚠ ' : ''}
                              {f.column}
                            </text>
                            <text
                              x={p.x + NODE_W - 12}
                              y={ry + 17}
                              textAnchor="end"
                              fontSize={10}
                              fontFamily="var(--font-sans)"
                              fill="var(--text-muted)"
                            >
                              {f.role === 'primary_key' ? 'pk' : f.role}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </Canvas>

        <ColHead>
          <AlertTriangle size={15} style={{ color: 'var(--warning-ink)' }} aria-hidden />
          Open decisions
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{open.length}</span>
        </ColHead>
        {open.map((d) => (
          <DecRow key={d.id} type="button" onClick={() => resolveById(d.id)} title={rationaleTitle(d)}>
            <DecTitle>{d.title}</DecTitle>
            <ConfidencePill $low>{pct(d.confidence)}</ConfidencePill>
          </DecRow>
        ))}

        <AskAgentBox placeholder="Tell the agent…  e.g. “merge sessions into orders” or “ignore test tables”" />

        <CrossSourceLinksPanel canWrite={canWrite} />
      </Col>

      <YamlPane
        yaml={state.yaml}
        fileName={state.draft ? `${state.draft.cubeName}.yml` : 'model.yml'}
        footer={
          <TriageActionBar
            canWrite={canWrite}
            validating={state.validating}
            validationLabel={validationLabel}
            validationOk={validationOk}
            staging={state.staging}
            staged={state.staged}
            openCount={state.openCount}
            onValidate={() => void state.validate()}
            onStage={() => void state.stageForApproval()}
          />
        }
      />
    </Grid>
  );
}
