// Screen 4 — Live predicate editor.
// Edits the predicate that drives a Live segment. Shows a member tree of the 4 cubes,
// a builder for AND/OR groups + leaves, and a live preview of the resolved cohort.

function EditorScreen({ segId, goDetail, goLibrary }) {
  const seg = SEGMENTS.find(s => s.id === segId) || SEGMENTS[0];

  const [name, setName]               = React.useState(seg.name);
  const [description, setDescription] = React.useState(seg.description);
  const [live, setLive]               = React.useState(seg.live);
  const [refresh, setRefresh]         = React.useState(seg.live ? seg.refresh : '1h');
  const [predicate, setPredicate]     = React.useState(
    seg.predicate || { kind: 'AND', children: [
      { kind: 'leaf', column: 'mf_users.country', op: '=', value: 'VN', type: 'string' },
    ]}
  );

  function updateNode(path, fn) {
    setPredicate((p) => {
      const clone = JSON.parse(JSON.stringify(p));
      let cur = clone;
      for (let i = 0; i < path.length - 1; i++) cur = cur.children[path[i]];
      if (path.length === 0) return fn(clone);
      const idx = path[path.length - 1];
      cur.children[idx] = fn(cur.children[idx]);
      return clone;
    });
  }
  function removeNode(path) {
    setPredicate((p) => {
      const clone = JSON.parse(JSON.stringify(p));
      if (path.length === 0) return clone;
      let cur = clone;
      for (let i = 0; i < path.length - 1; i++) cur = cur.children[path[i]];
      cur.children.splice(path[path.length - 1], 1);
      return clone;
    });
  }
  function addLeaf(path) {
    setPredicate((p) => {
      const clone = JSON.parse(JSON.stringify(p));
      let cur = clone;
      for (let i = 0; i < path.length; i++) cur = cur.children[path[i]];
      cur.children.push({ kind: 'leaf', column: HUB_COLUMNS[0].id, op: '=', value: '', type: HUB_COLUMNS[0].type });
      return clone;
    });
  }
  function addGroup(path) {
    setPredicate((p) => {
      const clone = JSON.parse(JSON.stringify(p));
      let cur = clone;
      for (let i = 0; i < path.length; i++) cur = cur.children[path[i]];
      cur.children.push({ kind: 'OR', children: [
        { kind: 'leaf', column: HUB_COLUMNS[0].id, op: '=', value: '', type: HUB_COLUMNS[0].type },
      ]});
      return clone;
    });
  }
  function toggleConj(path) {
    setPredicate((p) => {
      const clone = JSON.parse(JSON.stringify(p));
      let cur = clone;
      for (let i = 0; i < path.length; i++) cur = cur.children[path[i]];
      cur.kind = cur.kind === 'AND' ? 'OR' : 'AND';
      return clone;
    });
  }

  // Mock resolution — counts leaves as a stand-in for cohort math.
  const resolved = useResolveCohort(predicate, seg);

  return (
    <div className="page">
      <div className="crumbs">
        <a onClick={(e) => { e.preventDefault(); goLibrary(); }} href="#">Segments</a>
        <span className="sep">/</span>
        <a onClick={(e) => { e.preventDefault(); goDetail(seg.id); }} href="#">{seg.name}</a>
        <span className="sep">/</span>
        <span style={{ color: 'var(--text-primary)' }}>Edit predicate</span>
      </div>

      <div className="page-title-row">
        <div className="grow">
          <h1 className="page-title">Edit segment</h1>
          <p className="page-subtitle">
            Predicates resolve against the <span className="mono">mf_users</span> hub.
            Joinable cubes (<span className="mono">active_daily</span>, <span className="mono">user_recharge_daily</span>, <span className="mono">recharge</span>) are reachable via <span className="mono">user_id</span>.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => goDetail(seg.id)}>Cancel</button>
          <button className="btn btn-ghost btn-sm"><Icon name="eye" size={13}/>Preview SQL</button>
          <button className="btn btn-brand" onClick={() => goDetail(seg.id)}><Icon name="save" size={13}/>Save segment</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'flex-start' }}>
        <div className="col" style={{ gap: 16 }}>
          {/* Identity card */}
          <div className="card card-pad">
            <div className="grid-2" style={{ gap: 16 }}>
              <div>
                <FieldLabel>Name</FieldLabel>
                <div className="input" style={{ height: 36 }}>
                  <input value={name} onChange={(e) => setName(e.target.value)}/>
                </div>
              </div>
              <div>
                <FieldLabel>Description</FieldLabel>
                <div className="input" style={{ height: 36 }}>
                  <input value={description} onChange={(e) => setDescription(e.target.value)}/>
                </div>
              </div>
            </div>
          </div>

          {/* Predicate builder */}
          <div className="card">
            <div className="card-header">
              <div className="left">
                <Icon name="filter" size={14}/>
                <h3>Predicate</h3>
                <span className="muted" style={{ fontSize: 12 }}>
                  · users matching all conditions below are included
                </span>
              </div>
              <button className="btn btn-sm"><Icon name="copy" size={12}/>Paste from query</button>
            </div>
            <div style={{ padding: 16 }}>
              <PredicateGroup
                node={predicate}
                path={[]}
                onUpdate={(fn) => setPredicate(fn(predicate))}
                onUpdateChild={updateNode}
                onRemoveChild={removeNode}
                onAddLeaf={addLeaf}
                onAddGroup={addGroup}
                onToggleConj={toggleConj}
              />
            </div>
          </div>

          {/* Live/Static + refresh */}
          <div className="card card-pad">
            <FieldLabel>Refresh behaviour</FieldLabel>
            <div className="row" style={{ gap: 8 }}>
              <button
                className={`btn ${!live ? 'btn-primary' : ''}`}
                style={{ flex: 1, justifyContent: 'flex-start', height: 56 }}
                onClick={() => setLive(false)}
              >
                <Icon name="lock" size={16}/>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Static</div>
                  <div style={{ fontSize: 11.5, color: !live ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', fontWeight: 400 }}>
                    Resolve predicate once, freeze the list.
                  </div>
                </div>
              </button>
              <button
                className={`btn ${live ? 'btn-primary' : ''}`}
                style={{ flex: 1, justifyContent: 'flex-start', height: 56 }}
                onClick={() => setLive(true)}
              >
                <Icon name="zap" size={16}/>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Live</div>
                  <div style={{ fontSize: 11.5, color: live ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', fontWeight: 400 }}>
                    Re-resolve the predicate on a schedule.
                  </div>
                </div>
              </button>
            </div>
            {live && (
              <div className="row" style={{ marginTop: 12, gap: 12 }}>
                <FieldLabel>Refresh every</FieldLabel>
                <div className="tabs">
                  {['5m', '15m', '1h', '6h', '24h'].map(r => (
                    <button key={r} className={refresh === r ? 'active' : ''} onClick={() => setRefresh(r)}>{r}</button>
                  ))}
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  Cube pre-aggregations make 15m–1h cheap. 5m only on small predicates.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right rail */}
        <div className="col" style={{ gap: 16, position: 'sticky', top: 60 }}>
          <ResolvedPreview resolved={resolved}/>
          <CubeBrowser/>
        </div>
      </div>
    </div>
  );
}

// ────────── Resolution preview ──────────
function useResolveCohort(predicate, seg) {
  // Very rough estimate: shrink size by # of leaves. Real impl would call Cube.
  let leaves = 0;
  function count(n) {
    if (!n) return;
    if (n.kind === 'leaf') leaves += 1;
    else (n.children || []).forEach(count);
  }
  count(predicate);
  const base = 2_412_300; // mf_users.user_count_approx
  const ratio = Math.pow(0.35, Math.min(leaves, 6));
  const estimated = Math.max(100, Math.round(base * ratio));
  return {
    estimated,
    leaves,
    cubes: ['mf_users'],
    sqlPreview:
`SELECT user_id
FROM mf_users
WHERE ${flattenSql(predicate) || 'TRUE'}`,
  };
}

function flattenSql(node) {
  if (!node) return '';
  if (node.kind === 'leaf') {
    const v = node.value;
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    switch (node.op) {
      case 'set':    return `${node.column} IS NOT NULL`;
      case 'notSet': return `${node.column} IS NULL`;
      case 'IN':     return `${node.column} IN (${String(v).split(',').map(s => q(s.trim())).join(', ')})`;
      case 'NOT IN': return `${node.column} NOT IN (${String(v).split(',').map(s => q(s.trim())).join(', ')})`;
      case 'contains': return `${node.column} LIKE ${q('%' + v + '%')}`;
      case 'inDateRange': return `${node.column} IN ${q(v)}`;
      case 'beforeDate':  return `${node.column} < ${q(v)}`;
      case 'afterDate':   return `${node.column} > ${q(v)}`;
      default:
        if (node.type === 'number')  return `${node.column} ${node.op} ${v || 0}`;
        if (node.type === 'boolean') return `${node.column} ${node.op} ${v}`;
        return `${node.column} ${node.op} ${q(v)}`;
    }
  }
  const parts = node.children.map(c => `(${flattenSql(c)})`);
  return parts.join(` ${node.kind} `);
}

function ResolvedPreview({ resolved }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="left">
          <Icon name="target" size={14}/>
          <h3>Resolved cohort</h3>
        </div>
        <span className="badge badge-live"><span className="dot"/>Live preview</span>
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', fontFeatureSettings: '"tnum"' }}>
          {fmtInt(resolved.estimated)}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>user_ids · est. from <span className="mono">mf_users</span></div>
        <div className="divider"/>
        <FieldLabel>Generated SQL</FieldLabel>
        <pre style={{
          fontFamily: 'var(--font-mono)', fontSize: 11.5,
          background: 'var(--neutral-50)', border: '1px solid var(--border-card)',
          borderRadius: 8, padding: 10, margin: 0, whiteSpace: 'pre-wrap', overflow: 'auto',
          maxHeight: 180,
        }}>{resolved.sqlPreview}</pre>
      </div>
    </div>
  );
}

// ────────── Cube browser ──────────
function CubeBrowser() {
  return (
    <div className="cube-list">
      {CUBES.map((c, i) => (
        <React.Fragment key={c.name}>
          <div className="cube-head">
            <Icon name={c.icon} size={12}/>
            <span>{c.name}</span>
            <span className="grain">· {c.grain}</span>
            <div className="flex-1"/>
            <span className="muted" style={{ fontSize: 11 }}>{c.members} members</span>
          </div>
          {i === 0 && (
            <>
              {HUB_COLUMNS.slice(0, 5).map((m) => (
                <div className="member-row" key={m.id}>
                  <span className={`member-pill ${m.type === 'number' ? 'measure' : m.type === 'time' ? 'time' : 'dimension'}`} style={{ fontSize: 11, height: 18, padding: '0 6px' }}>
                    {m.type}
                  </span>
                  <span className="label">{m.id.replace('mf_users.', '')}</span>
                  <span className="typ">{m.type}</span>
                </div>
              ))}
            </>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ────────── Predicate group ──────────
function PredicateGroup({ node, path, onUpdateChild, onRemoveChild, onAddLeaf, onAddGroup, onToggleConj }) {
  const isRoot = path.length === 0;
  return (
    <div className="predicate" style={{ background: isRoot ? '#fcfcfc' : 'var(--neutral-50)' }}>
      <div className="group-bar">
        <span>Match</span>
        <span className="group-conj">
          <button className={node.kind === 'AND' ? 'active' : ''} onClick={() => onToggleConj(path)}>AND</button>
          <button className={node.kind === 'OR' ? 'active' : ''} onClick={() => onToggleConj(path)}>OR</button>
        </span>
        <span style={{ textTransform: 'none', fontWeight: 400, fontSize: 11.5 }}>
          {node.kind === 'AND' ? 'all conditions must match' : 'any condition can match'}
        </span>
        {!isRoot && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onRemoveChild(path)}
            style={{ marginLeft: 'auto' }}
            aria-label="Remove group"
          ><Icon name="x" size={12}/></button>
        )}
      </div>

      {node.children.map((c, idx) => {
        const childPath = [...path, idx];
        if (c.kind === 'leaf') {
          return (
            <Leaf
              key={idx}
              leaf={c}
              onChange={(next) => onUpdateChild(childPath, () => next)}
              onRemove={() => onRemoveChild(childPath)}
            />
          );
        }
        return (
          <PredicateGroup
            key={idx}
            node={c}
            path={childPath}
            onUpdateChild={onUpdateChild}
            onRemoveChild={onRemoveChild}
            onAddLeaf={onAddLeaf}
            onAddGroup={onAddGroup}
            onToggleConj={onToggleConj}
          />
        );
      })}

      <div className="add-row">
        <button className="btn btn-sm" onClick={() => onAddLeaf(path)}>
          <Icon name="plus" size={12}/>Add condition
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => onAddGroup(path)}>
          <Icon name="plus" size={12}/>Add group
        </button>
      </div>
    </div>
  );
}

// ────────── Leaf ──────────
function Leaf({ leaf, onChange, onRemove }) {
  const col = HUB_COLUMNS.find(c => c.id === leaf.column) || HUB_COLUMNS[0];
  const ops = OPERATORS[col.type] || OPERATORS.string;
  return (
    <div className="leaf-row">
      <div className="col-name">
        <span className="cube-prefix">mf_users.</span>
        <select
          value={leaf.column}
          onChange={(e) => {
            const next = HUB_COLUMNS.find(c => c.id === e.target.value);
            onChange({ ...leaf, column: next.id, type: next.type, op: (OPERATORS[next.type] || OPERATORS.string)[0].id, value: '' });
          }}
          style={{ flex: 1, border: 0, background: 'transparent', font: 'inherit', outline: 0 }}
        >
          {HUB_COLUMNS.map(c => (
            <option key={c.id} value={c.id}>{c.id.replace('mf_users.', '')}</option>
          ))}
        </select>
        <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--neutral-100)', color: 'var(--text-muted)' }}>{col.type}</span>
      </div>
      <select className="select" value={leaf.op} onChange={(e) => onChange({ ...leaf, op: e.target.value })} style={{ height: 30 }}>
        {ops.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <ValueInput leaf={leaf} onChange={onChange}/>
      <button className="remove" onClick={onRemove} aria-label="Remove condition"><Icon name="x" size={12}/></button>
    </div>
  );
}

function ValueInput({ leaf, onChange }) {
  if (leaf.op === 'set' || leaf.op === 'notSet') {
    return <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>(no value)</span>;
  }
  if (leaf.type === 'boolean') {
    return (
      <select className="select" value={leaf.value || 'true'} onChange={(e) => onChange({ ...leaf, value: e.target.value })} style={{ height: 30 }}>
        <option>true</option>
        <option>false</option>
      </select>
    );
  }
  if (leaf.type === 'time') {
    return (
      <div className="input" style={{ height: 30 }}>
        <Icon name="calendar-clock" size={12}/>
        <input value={leaf.value} onChange={(e) => onChange({ ...leaf, value: e.target.value })} placeholder="last 30 days"/>
      </div>
    );
  }
  return (
    <div className="input" style={{ height: 30 }}>
      <input
        type={leaf.type === 'number' ? 'text' : 'text'}
        value={leaf.value}
        onChange={(e) => onChange({ ...leaf, value: e.target.value })}
        placeholder={
          leaf.op === 'IN' || leaf.op === 'NOT IN' ? 'value, value, …' :
          leaf.type === 'number' ? '0' : 'value'
        }
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
      />
    </div>
  );
}

window.EditorScreen = EditorScreen;
