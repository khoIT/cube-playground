/**
 * Feature Atlas — detail drawer (the §4 triage surface). Identical across all 3
 * views. Sections: summary · drawbacks · directions · depends-on · depended-on-by
 * · links. Dep rows click-to-focus the target feature (the page relaxes filters).
 */
import { useEffect, type ReactElement } from 'react';
import { HEALTH_TOKENS } from './atlas-encoding';
import { DrawbackCount, EffortTag, HealthPill, StatusPill } from './atlas-badges';
import type { AtlasFeature, AtlasModel } from './atlas-types';

interface DrawerProps {
  feature: AtlasFeature;
  model: AtlasModel;
  onClose: () => void;
  onFocusFeature: (id: string) => void;
}

function DepRow({ id, model, onFocus }: { id: string; model: AtlasModel; onFocus: (id: string) => void }): ReactElement {
  const target = model.featById.get(id);
  if (!target) {
    return <div className="atlas-dep-row is-external">{id} · (external / unmodeled)</div>;
  }
  return (
    <button type="button" className="atlas-dep-row" onClick={() => onFocus(id)}>
      {target.label} · <span style={{ opacity: 0.7 }}>{target.surfaceLabel}</span>
    </button>
  );
}

function LinkGroup({ label, paths }: { label: string; paths: string[] }): ReactElement | null {
  if (!paths.length) return null;
  return (
    <div className="atlas-link-group">
      <div className="atlas-lg-label">{label}</div>
      {paths.map((p) => (
        <code key={p} className="atlas-path">{p}</code>
      ))}
    </div>
  );
}

export function AtlasDetailDrawer({ feature, model, onClose, onFocusFeature }: DrawerProps): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reverse = model.dependedOnBy.get(feature.id) ?? [];
  const accent = HEALTH_TOKENS[feature.health].ink;
  const hasLinks = feature.links.code.length || feature.links.plans.length || feature.links.memory.length;

  return (
    <>
      <div className="atlas-scrim" onClick={onClose} />
      <aside className="atlas-drawer" role="dialog" aria-label={`${feature.label} detail`}>
        <div className="atlas-drawer-head" style={{ borderLeftColor: accent }}>
          <div className="atlas-dh-eyebrow">{feature.surfaceLabel}</div>
          <div className="atlas-dh-title">
            <h3>{feature.label}</h3>
            <button type="button" className="atlas-dh-close" onClick={onClose} aria-label="Close">×</button>
          </div>
          <div className="atlas-dh-badges">
            <StatusPill status={feature.status} />
            <HealthPill health={feature.health} />
            {feature.lastTouched && (
              <span className="atlas-pill" style={{ background: 'var(--muted-soft)', color: 'var(--muted-ink)' }}>
                touched {feature.lastTouched}
              </span>
            )}
          </div>
        </div>

        <div className="atlas-drawer-body">
          <div className="atlas-sec">
            <h4>Summary</h4>
            <div className="atlas-summary-text">{feature.summary || <span className="atlas-empty-note">No summary.</span>}</div>
          </div>

          <div className="atlas-sec">
            <h4>Drawbacks <DrawbackCount n={feature.drawbacks.length} /></h4>
            {feature.drawbacks.length === 0 ? (
              <div className="atlas-empty-note">No known drawbacks.</div>
            ) : (
              feature.drawbacks.map((d, i) => <div key={i} className="atlas-callout">⚠ {d}</div>)
            )}
          </div>

          <div className="atlas-sec">
            <h4>Directions · ideation ({feature.directions.length})</h4>
            {feature.directions.length === 0 ? (
              <div className="atlas-empty-note">No directions logged yet.</div>
            ) : (
              feature.directions.map((d, i) => (
                <div key={i} className="atlas-dir-leaf">
                  <span className="atlas-dir-label">💡 {d.label}</span>
                  <span className="atlas-ef-wrap"><EffortTag effort={d.effort} /></span>
                </div>
              ))
            )}
          </div>

          <div className="atlas-sec">
            <h4>Depends on ({feature.deps.length})</h4>
            {feature.deps.length === 0 ? (
              <div className="atlas-empty-note">No dependencies.</div>
            ) : (
              feature.deps.map((id) => <DepRow key={id} id={id} model={model} onFocus={onFocusFeature} />)
            )}
          </div>

          <div className="atlas-sec">
            <h4>Depended on by ({reverse.length})</h4>
            {reverse.length === 0 ? (
              <div className="atlas-empty-note">Nothing depends on this.</div>
            ) : (
              reverse.map((id) => <DepRow key={id} id={id} model={model} onFocus={onFocusFeature} />)
            )}
          </div>

          {hasLinks ? (
            <div className="atlas-sec">
              <h4>Links</h4>
              <LinkGroup label="Code" paths={feature.links.code} />
              <LinkGroup label="Plans" paths={feature.links.plans} />
              <LinkGroup label="Memory" paths={feature.links.memory} />
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
