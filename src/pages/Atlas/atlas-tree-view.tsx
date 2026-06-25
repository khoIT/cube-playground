/**
 * Feature Atlas — Variant 1: collapsible indented tree. Surfaces expanded by
 * default (with a health-composition bar); directions folded per-feature.
 */
import { useState, type ReactElement } from 'react';
import { HEALTH_ORDER, HEALTH_TOKENS } from './atlas-encoding';
import { DepCount, DrawbackCount, EffortTag, StatusPill } from './atlas-badges';
import type { AtlasFeature, AtlasModel, FeatureHealth } from './atlas-types';

interface ViewProps {
  model: AtlasModel;
  visible: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function HealthBar({ features }: { features: AtlasFeature[] }): ReactElement {
  const counts = features.reduce<Record<FeatureHealth, number>>(
    (acc, f) => { acc[f.health] = (acc[f.health] ?? 0) + 1; return acc; },
    { healthy: 0, partial: 0, 'at-risk': 0, stale: 0 },
  );
  const total = features.length || 1;
  return (
    <span className="atlas-health-bar" title="Health composition">
      {HEALTH_ORDER.map((h) => counts[h] > 0 && (
        <span key={h} style={{ width: `${(counts[h] / total) * 100}%`, background: HEALTH_TOKENS[h].ink }} />
      ))}
    </span>
  );
}

function FeatureRow({ feature, selected, onSelect }: { feature: AtlasFeature; selected: boolean; onSelect: (id: string) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const accent = HEALTH_TOKENS[feature.health].ink;
  return (
    <>
      <div
        className={`atlas-feature-row${selected ? ' is-selected' : ''}`}
        style={{ borderLeftColor: accent }}
        onClick={() => onSelect(feature.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect(feature.id); }}
      >
        {feature.directions.length > 0 && (
          <button
            type="button"
            className="atlas-dir-toggle"
            aria-expanded={open}
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            title={`${feature.directions.length} direction(s)`}
          >
            {open ? '▾' : '▸'} 💡{feature.directions.length}
          </button>
        )}
        <span className="atlas-fr-label">{feature.label}</span>
        <span className="atlas-fr-summary">{feature.summary}</span>
        <span className="atlas-fr-right">
          <DrawbackCount n={feature.drawbacks.length} />
          <DepCount n={feature.deps.length} />
          <StatusPill status={feature.status} />
        </span>
      </div>
      {open && feature.directions.map((d, i) => (
        <div key={i} className="atlas-dir-leaf">
          <span className="atlas-dir-label">💡 {d.label}</span>
          <EffortTag effort={d.effort} />
        </div>
      ))}
    </>
  );
}

export function AtlasTreeView({ model, visible, selectedId, onSelect }: ViewProps): ReactElement {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div>
      {model.surfaces.map((surface) => {
        const feats = surface.features.filter((f) => visible.has(f.id));
        if (feats.length === 0) return null;
        const isCollapsed = collapsed.has(surface.id);
        return (
          <section className="atlas-surface" key={surface.id}>
            <button type="button" className="atlas-surface-head" onClick={() => toggle(surface.id)} aria-expanded={!isCollapsed}>
              <span className="atlas-caret">{isCollapsed ? '▸' : '▾'}</span>
              <h2>{surface.label}</h2>
              <span className="atlas-surface-count">{feats.length}</span>
              <HealthBar features={feats} />
            </button>
            {!isCollapsed && feats.map((f) => (
              <FeatureRow key={f.id} feature={f} selected={f.id === selectedId} onSelect={onSelect} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
