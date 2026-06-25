/**
 * Feature Atlas — in-app page at /admin/atlas. Pure renderer of the committed
 * atlas.yaml spine: load → filter/search → one of three swappable views (tree /
 * graph / swimlane) → shared detail drawer. All feature state lives in the YAML;
 * never encode feature state in this component (the pure-renderer invariant).
 */
import { useMemo, useState, type ReactElement } from 'react';
import './atlas.css';
import { loadAtlas } from './atlas-data';
import {
  HEALTH_ORDER, HEALTH_TOKENS, STATUS_ORDER, STATUS_TOKENS, matchesSearch, formatReconciledAt,
} from './atlas-encoding';
import { AtlasTreeView } from './atlas-tree-view';
import { AtlasSwimlaneView } from './atlas-swimlane-view';
import { AtlasGraphView } from './atlas-graph-view';
import { AtlasDetailDrawer } from './atlas-detail-drawer';
import type { AtlasFeature, FeatureHealth, FeatureStatus } from './atlas-types';

type ViewKind = 'tree' | 'graph' | 'swimlane';

const VIEWS: Array<{ key: ViewKind; label: string }> = [
  { key: 'swimlane', label: 'Triage' },
  { key: 'tree', label: 'Map' },
  { key: 'graph', label: 'Graph' },
];

function toggleIn<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v); else next.add(v);
  return next;
}

export function AtlasPage(): ReactElement {
  // All hooks run unconditionally (rules of hooks) — the load error is rendered
  // via an early return *after* every hook below.
  const result = useMemo(() => loadAtlas(), []);
  const modelOrNull = result.ok ? result.model : null;
  const errorMsg = 'error' in result ? result.error : null;
  const [view, setView] = useState<ViewKind>('swimlane');
  const [statuses, setStatuses] = useState<Set<FeatureStatus>>(new Set());
  const [healths, setHealths] = useState<Set<FeatureHealth>>(new Set());
  const [surfaces, setSurfaces] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const allFeatures = useMemo(
    () => (modelOrNull ? modelOrNull.surfaces.flatMap((s) => s.features) : []),
    [modelOrNull],
  );

  // Faceted predicate — `skip` excludes one dimension so that dimension's chip
  // counts reflect what selecting it would yield (standard facet behavior).
  const passes = (f: AtlasFeature, skip?: 'status' | 'health' | 'surface'): boolean =>
    (skip === 'status' || statuses.size === 0 || statuses.has(f.status)) &&
    (skip === 'health' || healths.size === 0 || healths.has(f.health)) &&
    (skip === 'surface' || surfaces.size === 0 || surfaces.has(f.surfaceId)) &&
    matchesSearch(f, search);

  const visible = useMemo(() => {
    const ids = new Set<string>();
    for (const f of allFeatures) if (passes(f)) ids.add(f.id);
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFeatures, statuses, healths, surfaces, search]);

  if (!result.ok) {
    return (
      <div className="atlas-page">
        <div className="atlas-head"><div className="atlas-title"><h1>Feature Atlas</h1></div></div>
        <div className="atlas-error">{errorMsg}</div>
      </div>
    );
  }
  const model = result.model;

  const countFor = (value: string, dim: 'status' | 'health' | 'surface'): number =>
    allFeatures.filter((f) => passes(f, dim) && (dim === 'status' ? f.status : dim === 'health' ? f.health : f.surfaceId) === value).length;

  const clearAll = () => { setStatuses(new Set()); setHealths(new Set()); setSurfaces(new Set()); setSearch(''); };

  // Dep click-to-focus: relax filters/search so the target is never hidden, then select it.
  const focusFeature = (id: string) => {
    if (!visible.has(id)) clearAll();
    setSelectedId(id);
  };

  const selected = selectedId ? model.featById.get(selectedId) ?? null : null;
  const ViewCmp = view === 'tree' ? AtlasTreeView : view === 'graph' ? AtlasGraphView : AtlasSwimlaneView;
  const hasFilter = statuses.size || healths.size || surfaces.size || search;

  return (
    <div className="atlas-page">
      <div className="atlas-head">
        <div className="atlas-eyebrow">Development</div>
        <div className="atlas-title">
          <h1>🗺️ Feature Atlas</h1>
          <span className="atlas-meta" title={`reconciled ${model.reconciledAt}`}>{visible.size}/{allFeatures.length} features · reconciled {formatReconciledAt(model.reconciledAt)}</span>
        </div>
        <p className="atlas-sub">Living triage &amp; ideation map — health, drawbacks, directions, and links per feature. Edit via <code>/atlas reconcile</code>; this page is a pure renderer.</p>
      </div>

      <div className="atlas-controls">
        <div className="atlas-row">
          <div className="atlas-switch">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => setView(v.key)}>{v.label}</button>
            ))}
          </div>
          <input className="atlas-search" placeholder="Search label or summary…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {hasFilter ? <button type="button" className="atlas-linkbtn" onClick={clearAll}>Clear filters</button> : null}
        </div>

        <div className="atlas-row">
          <span className="atlas-row-label">Health</span>
          {HEALTH_ORDER.map((h) => (
            <button key={h} type="button" className="atlas-chip" aria-pressed={healths.has(h)} onClick={() => setHealths((s) => toggleIn(s, h))}>
              <span className="atlas-chip-dot" style={{ background: HEALTH_TOKENS[h].ink }} />
              {HEALTH_TOKENS[h].label}<span className="atlas-chip-count">{countFor(h, 'health')}</span>
            </button>
          ))}
        </div>

        <div className="atlas-row">
          <span className="atlas-row-label">Status</span>
          {STATUS_ORDER.map((st) => (
            <button key={st} type="button" className="atlas-chip" aria-pressed={statuses.has(st)} onClick={() => setStatuses((s) => toggleIn(s, st))}>
              {STATUS_TOKENS[st].label}<span className="atlas-chip-count">{countFor(st, 'status')}</span>
            </button>
          ))}
        </div>

        <div className="atlas-row">
          <span className="atlas-row-label">Surface</span>
          {model.surfaces.map((s) => (
            <button key={s.id} type="button" className="atlas-chip" aria-pressed={surfaces.has(s.id)} onClick={() => setSurfaces((prev) => toggleIn(prev, s.id))}>
              {s.label}<span className="atlas-chip-count">{countFor(s.id, 'surface')}</span>
            </button>
          ))}
        </div>

        <div className="atlas-legend">
          {HEALTH_ORDER.map((h) => (
            <span key={h} className="atlas-legend-item"><span className="atlas-dot" style={{ background: HEALTH_TOKENS[h].ink }} />{HEALTH_TOKENS[h].label}</span>
          ))}
          <span className="atlas-legend-item"><span className="atlas-legend-dash" />Direction (idea)</span>
        </div>
      </div>

      <div className="atlas-body">
        {visible.size === 0 ? (
          <div className="atlas-empty">No features match the current filters. <button type="button" className="atlas-linkbtn" onClick={clearAll}>Clear filters</button></div>
        ) : (
          <ViewCmp model={model} visible={visible} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </div>

      {selected && (
        <AtlasDetailDrawer feature={selected} model={model} onClose={() => setSelectedId(null)} onFocusFeature={focusFeature} />
      )}
    </div>
  );
}

export default AtlasPage;
