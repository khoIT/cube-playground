// Screen 2 — Segment library landing.

function LibraryScreen({ goDetail, goNew }) {
  const [q, setQ] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState('all'); // all | live | static
  const [sortKey, setSortKey] = React.useState('updated');

  let list = SEGMENTS.filter(s => {
    if (typeFilter === 'live' && !s.live) return false;
    if (typeFilter === 'static' && s.live) return false;
    if (q && !(s.name + ' ' + s.description).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  if (sortKey === 'size')    list = [...list].sort((a, b) => b.size - a.size);
  if (sortKey === 'name')    list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  if (sortKey === 'updated') list = list; // already mock-sorted

  const totalLive    = SEGMENTS.filter(s => s.live).length;
  const totalStatic  = SEGMENTS.filter(s => !s.live).length;
  const totalIds     = SEGMENTS.reduce((s, x) => s + x.size, 0);

  return (
    <div className="page">
      <div className="page-title-row">
        <div className="grow">
          <h1 className="page-title">Segments</h1>
          <p className="page-subtitle">
            Persistent user-id cohorts. {totalLive} live · {totalStatic} static · {fmtInt(totalIds)} unique users across all segments.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn"><Icon name="download" size={13}/>Import IDs</button>
          <button className="btn btn-brand" onClick={goNew}><Icon name="plus" size={13}/>New segment</button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Tile label="Live segments"    value={totalLive}     delta={0.0833} foot="Auto-refreshing from predicate"/>
        <Tile label="Static segments"  value={totalStatic}   delta={null}   foot="Frozen user-id lists"/>
        <Tile label="Total user-ids"   value={fmtInt(totalIds)} delta={0.022} foot="Sum across all segments"/>
        <Tile label="In use"           value="47 dashboards" delta={0.16}   foot="Across views · MCP · saved analyses"/>
      </div>

      {/* Toolbar */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border-card)' }}>
          <div className="input input-search" style={{ width: 280 }}>
            <Icon name="search" size={13}/>
            <input placeholder="Search segments…" value={q} onChange={(e) => setQ(e.target.value)}/>
          </div>
          <div className="tabs">
            {[
              { id: 'all',    label: `All · ${SEGMENTS.length}` },
              { id: 'live',   label: `Live · ${totalLive}` },
              { id: 'static', label: `Static · ${totalStatic}` },
            ].map(t => (
              <button key={t.id} className={typeFilter === t.id ? 'active' : ''} onClick={() => setTypeFilter(t.id)}>{t.label}</button>
            ))}
          </div>
          <div className="flex-1"/>
          <div className="row" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>Sort by</span>
            <select className="select" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              <option value="updated">Recently updated</option>
              <option value="size">Size</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        <div role="table">
          <div className="seg-table-row head">
            <div>Segment</div>
            <div>Type</div>
            <div>Last refresh</div>
            <div className="num" style={{ textAlign: 'right' }}>Size</div>
            <div>Trend</div>
            <div>Owner</div>
          </div>

          {list.map((s) => (
            <SegRow key={s.id} s={s} onClick={() => goDetail(s.id)}/>
          ))}

          {list.length === 0 && (
            <div className="empty">No segments match this filter.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, delta, foot }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{typeof value === 'number' ? fmtInt(value) : value}</div>
      <div className="row" style={{ marginTop: 4, gap: 8 }}>
        {delta != null && (
          <span className={`delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}`}>
            <Icon name={delta > 0 ? 'trending-up' : 'trending-down'} size={11}/>{fmtDelta(delta)}
          </span>
        )}
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>· {foot}</span>
      </div>
    </div>
  );
}

function SegRow({ s, onClick }) {
  return (
    <div className="seg-table-row" onClick={onClick}>
      <div className="seg-name">
        <span className="title">
          {s.name}
        </span>
        <span className="desc">{s.description}</span>
        <span className="tags">
          {s.tags.map(t => <span key={t} className="tag">{t}</span>)}
        </span>
      </div>
      <div>
        <LiveBadge live={s.live} refresh={s.refresh}/>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        <div>{s.updated}</div>
        {s.live && <div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>next in {s.nextRefresh}</div>}
      </div>
      <div className="size-cell" style={{ justifyContent: 'flex-end' }}>
        <span className="num">{fmtInt(s.size)}</span>
        {s.sizeDelta != null && (
          <span className={`delta ${s.sizeDelta >= 0 ? 'up' : 'down'}`}>{fmtDelta(s.sizeDelta)}</span>
        )}
      </div>
      <div>
        <Sparkline data={s.sparkline} color={s.avatar} width={80} height={22}/>
      </div>
      <div className="owner-chip">
        <Avatar name={s.owner} color={s.avatar}/>
        {s.owner}
        <Icon name="chevron-right" size={14} style={{ color: 'var(--text-muted)', marginLeft: 8 }}/>
      </div>
    </div>
  );
}

window.LibraryScreen = LibraryScreen;
