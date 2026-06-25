/**
 * Feature Atlas — Variant 3: triage swimlane / kanban. Lanes by status (default),
 * health, or surface. KPI banner up top; within-lane at-risk-first sort. The
 * strongest operational "what needs attention now" view.
 */
import { useState, type ReactElement } from 'react';
import {
  HEALTH_ORDER, HEALTH_PRIORITY, HEALTH_TOKENS, STATUS_ORDER, STATUS_TOKENS,
} from './atlas-encoding';
import { DepCount, DrawbackCount, EffortTag, HealthPill, StatusPill } from './atlas-badges';
import type { AtlasFeature, AtlasModel, FeatureHealth, FeatureStatus } from './atlas-types';

type LaneMode = 'status' | 'health' | 'surface';

interface ViewProps {
  model: AtlasModel;
  visible: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function laneSpec(mode: LaneMode, model: AtlasModel): Array<{ key: string; label: string; accent: string }> {
  if (mode === 'status') return STATUS_ORDER.map((s) => ({ key: s, label: STATUS_TOKENS[s].label, accent: STATUS_TOKENS[s].ink }));
  if (mode === 'health') return HEALTH_ORDER.map((h) => ({ key: h, label: HEALTH_TOKENS[h].label, accent: HEALTH_TOKENS[h].ink }));
  return model.surfaces.map((s) => ({ key: s.id, label: s.label, accent: 'var(--text-muted)' }));
}

function laneOf(f: AtlasFeature, mode: LaneMode): string {
  if (mode === 'status') return f.status;
  if (mode === 'health') return f.health;
  return f.surfaceId;
}

function Card({ feature, selected, onSelect }: { feature: AtlasFeature; selected: boolean; onSelect: (id: string) => void }): ReactElement {
  return (
    <div
      className={`atlas-card${selected ? ' is-selected' : ''}`}
      style={{ borderLeftColor: HEALTH_TOKENS[feature.health].ink }}
      onClick={() => onSelect(feature.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(feature.id); }}
    >
      <div className="atlas-card-top">
        <span className="atlas-card-label">{feature.label}</span>
        <span className="atlas-card-surface" style={{ marginLeft: 'auto' }}>{feature.surfaceLabel}</span>
      </div>
      {feature.summary && <div className="atlas-card-summary">{feature.summary}</div>}
      <div className="atlas-card-chips">
        <StatusPill status={feature.status} />
        <DrawbackCount n={feature.drawbacks.length} />
        <DepCount n={feature.deps.length} />
        {feature.directions.map((d, i) => (
          <span key={i} className="atlas-ef" title={d.label}>💡 {d.label.length > 22 ? `${d.label.slice(0, 22)}…` : d.label}{d.effort ? <EffortTag effort={d.effort} /> : null}</span>
        ))}
      </div>
    </div>
  );
}

export function AtlasSwimlaneView({ model, visible, selectedId, onSelect }: ViewProps): ReactElement {
  const [mode, setMode] = useState<LaneMode>('status');
  const feats: AtlasFeature[] = [];
  for (const s of model.surfaces) for (const f of s.features) if (visible.has(f.id)) feats.push(f);

  const kpi = {
    atRisk: feats.filter((f) => f.health === 'at-risk').length,
    inFlight: feats.filter((f) => f.status === 'in-flight').length,
    planned: feats.filter((f) => f.status === 'planned' || f.status === 'idea').length,
    drawbacks: feats.reduce((n, f) => n + f.drawbacks.length, 0),
    directions: feats.reduce((n, f) => n + f.directions.length, 0),
  };

  const lanes = laneSpec(mode, model).map((lane) => ({
    ...lane,
    items: feats
      .filter((f) => laneOf(f, mode) === lane.key)
      .sort((a, b) => HEALTH_PRIORITY[a.health] - HEALTH_PRIORITY[b.health]),
  }));

  return (
    <div>
      <div className="atlas-row" style={{ marginBottom: 10 }}>
        <span className="atlas-row-label">Lanes by</span>
        <div className="atlas-switch">
          {(['status', 'health', 'surface'] as LaneMode[]).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="atlas-kpis">
        {[
          { n: kpi.atRisk, l: 'At risk', c: HEALTH_TOKENS['at-risk'].ink },
          { n: kpi.inFlight, l: 'In-flight', c: STATUS_TOKENS['in-flight'].ink },
          { n: kpi.planned, l: 'Planned/idea', c: STATUS_TOKENS.planned.ink },
          { n: kpi.drawbacks, l: 'Drawbacks', c: 'var(--destructive-ink)' },
          { n: kpi.directions, l: 'Directions', c: 'var(--info-ink)' },
        ].map((k) => (
          <div className="atlas-kpi" key={k.l}>
            <div className="atlas-kpi-n" style={{ color: k.c }}>{k.n}</div>
            <div className="atlas-kpi-l">{k.l}</div>
          </div>
        ))}
      </div>

      <div className="atlas-lanes">
        {lanes.map((lane) => (
          <div className="atlas-lane" key={lane.key}>
            <div className="atlas-lane-head">
              <span className="atlas-dot" style={{ background: lane.accent }} />
              {lane.label}
              <span className="atlas-lane-count">{lane.items.length}</span>
            </div>
            {lane.items.map((f) => (
              <Card key={f.id} feature={f} selected={f.id === selectedId} onSelect={onSelect} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
