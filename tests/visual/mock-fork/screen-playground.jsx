// Screen 1 — Playground/Results.
// Shows a faithful slice of the QueryBuilder Results tab with selectable rows,
// then offers 3 push-to-segment patterns: action bar, side sheet, modal.

const { useState: useState1, useMemo: useMemo1, useEffect: useEffect1 } = React;

function PlaygroundScreen({ goSegment, pushPattern, setPushPattern }) {
  // Pre-select 5 rows for the demo so the action surface is visible immediately.
  const [selected, setSelected] = useState1(new Set(['u_8e2a91', 'u_4c81f0', 'u_9f0c42', 'u_b3145e', 'u_c421a7']));
  const [pushOpen, setPushOpen] = useState1(false);
  const [pushedSegId, setPushedSegId] = useState1(null);

  const allSelected = selected.size === RESULTS_ROWS.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleRow(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === RESULTS_ROWS.length) setSelected(new Set());
    else setSelected(new Set(RESULTS_ROWS.map(r => r.user_id)));
  }

  const selectedRows = RESULTS_ROWS.filter(r => selected.has(r.user_id));
  // Aggregate hub attributes for the selection summary
  const summary = useMemo1(() => {
    if (selectedRows.length === 0) return null;
    const countries = {}; const tiers = {}; const channels = {};
    let totalArpu = 0;
    selectedRows.forEach((r) => {
      countries[r.country] = (countries[r.country] || 0) + 1;
      tiers[r.payer_tier] = (tiers[r.payer_tier] || 0) + 1;
      channels[r.channel] = (channels[r.channel] || 0) + 1;
      totalArpu += r.arpu_vnd;
    });
    return {
      avgArpu: Math.round(totalArpu / selectedRows.length),
      countries: Object.entries(countries).sort((a, b) => b[1] - a[1]),
      tiers: Object.entries(tiers).sort((a, b) => b[1] - a[1]),
      channels: Object.entries(channels).sort((a, b) => b[1] - a[1]),
    };
  }, [selectedRows]);

  // Toast for after push
  useEffect1(() => {
    if (pushedSegId) {
      const t = setTimeout(() => setPushedSegId(null), 4000);
      return () => clearTimeout(t);
    }
  }, [pushedSegId]);

  function handlePushed(segId) {
    setPushOpen(false);
    setPushedSegId(segId);
  }

  return (
    <div className="page">
      {/* Query band — like the toolbar above Results in QueryBuilder */}
      <div className="card" style={{ marginBottom: 14, padding: 0 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-card)' }}>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <QueryRow label="MEASURES" pills={[
              { kind: 'measure', text: 'active_daily.dau_exact' },
              { kind: 'measure', text: 'mf_users.arpu_vnd' },
            ]}/>
            <QueryRow label="DIMENSIONS" pills={[
              { kind: 'dimension', text: 'mf_users.user_id' },
              { kind: 'dimension', text: 'mf_users.country' },
              { kind: 'dimension', text: 'mf_users.channel' },
              { kind: 'dimension', text: 'mf_users.platform' },
              { kind: 'dimension', text: 'mf_users.payer_tier' },
            ]}/>
            <QueryRow label="FILTERS" pills={[
              { kind: 'segment', text: 'mf_users.country = VN' },
              { kind: 'segment', text: 'mf_users.payer_tier = whale' },
              { kind: 'time',    text: 'active_daily.log_date · last 30 days' },
            ]}/>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--neutral-50)', borderRadius: '0 0 var(--radius-xl) var(--radius-xl)' }}>
          <div className="tabs">
            <button>Chart</button>
            <button>Pivot</button>
            <button className="active">Results</button>
            <button>SQL</button>
          </div>
          <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
            <Icon name="check-circle" size={12} stroke={2} style={{ color: 'var(--success)', verticalAlign: '-2px', marginRight: 4 }}/>
            <strong style={{ color: 'var(--text-primary)' }}>{RESULTS_ROWS.length}</strong> rows · queried in 412 ms
          </span>
          <div className="flex-1"/>
          <button className="btn btn-sm btn-ghost"><Icon name="download" size={12}/>Export CSV</button>
          <button className="btn btn-sm btn-ghost"><Icon name="copy" size={12}/>Copy</button>
          {/* Push-pattern picker (only visible when selection exists; otherwise hidden) */}
          {selected.size > 0 && (
            <div className="tabs" title="Push-to-segment pattern" style={{ marginLeft: 4 }}>
              {[
                { id: 'bar',   label: 'Action bar' },
                { id: 'sheet', label: 'Side sheet' },
                { id: 'modal', label: 'Modal' },
              ].map(p => (
                <button
                  key={p.id}
                  className={pushPattern === p.id ? 'active' : ''}
                  onClick={() => setPushPattern(p.id)}
                >{p.label}</button>
              ))}
            </div>
          )}
        </div>

        {/* The table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th className="checkbox-cell">
                  <input
                    type="checkbox"
                    className={`checkbox${someSelected ? ' indeterminate' : ''}`}
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th>user_id</th>
                <th>country</th>
                <th>channel</th>
                <th>platform</th>
                <th>payer_tier</th>
                <th className="num">arpu_vnd</th>
                <th>last_active</th>
                <th>first_recharge</th>
              </tr>
            </thead>
            <tbody>
              {RESULTS_ROWS.map((r, i) => {
                const isSel = selected.has(r.user_id);
                return (
                  <tr key={r.user_id} className={isSel ? 'selected' : ''} onClick={() => toggleRow(r.user_id)}>
                    <td className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={isSel}
                        onChange={() => toggleRow(r.user_id)}
                      />
                    </td>
                    <td className="mono">{r.user_id}</td>
                    <td>{r.country}</td>
                    <td>{r.channel}</td>
                    <td>{r.platform}</td>
                    <td>
                      <span className={`badge ${r.payer_tier === 'whale' ? '' : ''}`} style={{
                        background: TIER_BG[r.payer_tier] || 'var(--neutral-100)',
                        color: TIER_FG[r.payer_tier] || 'var(--text-secondary)',
                      }}>{r.payer_tier}</span>
                    </td>
                    <td className="num mono">{r.arpu_vnd ? fmtVnd(r.arpu_vnd) : '—'}</td>
                    <td className="mono" style={{ color: 'var(--text-muted)' }}>{r.last_active}</td>
                    <td className="mono" style={{ color: 'var(--text-muted)' }}>{r.first_recharge || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast */}
      {pushedSegId && (
        <PushedToast segId={pushedSegId} onView={() => { setPushedSegId(null); goSegment(pushedSegId); }} onClose={() => setPushedSegId(null)}/>
      )}

      {/* Action bar pattern */}
      {pushPattern === 'bar' && selected.size > 0 && (
        <ActionBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          onPush={() => setPushOpen(true)}
        />
      )}

      {/* Side sheet pattern */}
      {pushPattern === 'sheet' && (
        <PushSheet
          open={pushOpen}
          selectedRows={selectedRows}
          summary={summary}
          onClose={() => setPushOpen(false)}
          onConfirm={(id) => handlePushed(id)}
        />
      )}

      {/* Modal pattern */}
      {pushPattern === 'modal' && (
        <PushModal
          open={pushOpen}
          selectedRows={selectedRows}
          summary={summary}
          onClose={() => setPushOpen(false)}
          onConfirm={(id) => handlePushed(id)}
        />
      )}

      {/* Sheet / Modal patterns get a stationary "Push" button as the action bar's stand-in */}
      {(pushPattern === 'sheet' || pushPattern === 'modal') && selected.size > 0 && (
        <ActionBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          onPush={() => setPushOpen(true)}
          variant={pushPattern}
        />
      )}
    </div>
  );
}

const TIER_BG = {
  whale: 'rgba(240, 90, 34, 0.12)',
  dolphin: 'rgba(63, 141, 255, 0.12)',
  minnow: 'rgba(115, 115, 115, 0.12)',
  non_payer: 'transparent',
};
const TIER_FG = {
  whale: 'var(--orange-700)',
  dolphin: '#1d4ed8',
  minnow: 'var(--neutral-700)',
  non_payer: 'var(--text-muted)',
};

// ────────── Query band rows ──────────
function QueryRow({ label, pills }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <span style={{ fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 600, minWidth: 72 }}>{label}</span>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {pills.map((p, i) => (
          <span key={i} className={`member-pill ${p.kind}`}>{p.text}</span>
        ))}
      </div>
    </div>
  );
}

// ────────── Pattern 1: Action bar ──────────
function ActionBar({ count, onClear, onPush, variant }) {
  return (
    <div className="selection-bar" style={{ maxWidth: 1360 }}>
      <span className="count"><strong>{count}</strong> user_ids selected</span>
      <span className="divider"/>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
        from <span style={{ color: 'white', fontFamily: 'var(--font-mono)' }}>mf_users.user_id</span>
      </span>
      <div className="grow"/>
      <button className="bar-btn icon-only" onClick={onClear} aria-label="Clear selection"><Icon name="x" size={14}/></button>
      <button className="bar-btn"><Icon name="copy" size={12}/>Copy IDs</button>
      <button className="bar-btn"><Icon name="download" size={12}/>Export</button>
      <button className="bar-btn primary" onClick={onPush}>
        <Icon name="send-to-back" size={13}/>
        {variant === 'bar' || !variant ? 'Save as segment' : variant === 'sheet' ? 'Push to segment' : 'Push to segment'}
        <Icon name="arrow-right" size={12}/>
      </button>
    </div>
  );
}

// ────────── Pattern 2: Side sheet ──────────
function PushSheet({ open, selectedRows, summary, onClose, onConfirm }) {
  const [name, setName] = useState1('Whales · VN · 14-May export');
  const [desc, setDesc] = useState1('Pushed from Playground · cohort for retention test');
  const [live, setLive] = useState1(false);
  return (
    <>
      <div className={`scrim${open ? ' open' : ''}`} onClick={onClose}/>
      <aside className={`sheet${open ? ' open' : ''}`} aria-label="Push to segment">
        <div className="sheet-header">
          <Icon name="send-to-back" size={16}/>
          <h3>Push to segment</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><Icon name="x" size={14}/></button>
        </div>
        <div className="sheet-body">
          <SegSummary count={selectedRows.length} summary={summary}/>

          <div className="divider"/>

          <FieldLabel>Segment name</FieldLabel>
          <div className="input" style={{ height: 34 }}>
            <input value={name} onChange={(e) => setName(e.target.value)}/>
          </div>

          <div style={{ height: 12 }}/>

          <FieldLabel>Description <span className="muted" style={{ fontWeight: 400 }}>· optional</span></FieldLabel>
          <textarea
            className="input"
            style={{ width: '100%', height: 60, paddingTop: 8, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.4, resize: 'vertical' }}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />

          <div style={{ height: 12 }}/>

          <FieldLabel>Type</FieldLabel>
          <div className="row" style={{ gap: 8 }}>
            <button
              className={`btn ${!live ? 'btn-primary' : ''}`}
              style={{ flex: 1, justifyContent: 'flex-start' }}
              onClick={() => setLive(false)}
            >
              <Icon name="lock" size={14}/>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Static</div>
                <div style={{ fontSize: 11, color: !live ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', fontWeight: 400 }}>Frozen list of {selectedRows.length} IDs</div>
              </div>
            </button>
            <button
              className={`btn ${live ? 'btn-primary' : ''}`}
              style={{ flex: 1, justifyContent: 'flex-start' }}
              onClick={() => setLive(true)}
            >
              <Icon name="zap" size={14}/>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Live</div>
                <div style={{ fontSize: 11, color: live ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', fontWeight: 400 }}>Refresh from query predicate</div>
              </div>
            </button>
          </div>

          {live && (
            <div style={{ marginTop: 10, background: 'var(--brand-soft)', border: '1px solid var(--orange-200)', borderRadius: 8, padding: 10, fontSize: 12, color: 'var(--orange-900)' }}>
              <strong>Heads-up.</strong> Live segments inherit the active Playground predicate
              (<span className="member-pill segment" style={{ fontSize: 11, height: 18, padding: '0 6px' }}>country = VN</span>{' '}
              <span className="member-pill segment" style={{ fontSize: 11, height: 18, padding: '0 6px' }}>payer_tier = whale</span>),
              not the row selection. You can edit the predicate after saving.
            </div>
          )}

          <div style={{ height: 12 }}/>
          <FieldLabel>Tags</FieldLabel>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {['vip', 'revenue', 'ad-hoc'].map((t) => (
              <span key={t} className="tag" style={{ cursor: 'pointer', padding: '2px 10px' }}>{t}</span>
            ))}
            <button className="btn btn-ghost btn-sm"><Icon name="plus" size={11}/>Add tag</button>
          </div>
        </div>
        <div className="sheet-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-brand" onClick={() => onConfirm('seg.ad_hoc_2305')}>
            <Icon name="check" size={13}/>Create segment
          </button>
        </div>
      </aside>
    </>
  );
}

// ────────── Pattern 3: Modal ──────────
function PushModal({ open, selectedRows, summary, onClose, onConfirm }) {
  const [name, setName] = useState1('Whales · VN · 14-May export');
  const [mode, setMode] = useState1('new'); // new | append
  const [appendTo, setAppendTo] = useState1('seg.whales_vn');
  return (
    <>
      <div className={`scrim${open ? ' open' : ''}`} onClick={onClose}/>
      <div className={`modal${open ? ' open' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-card">
          <div className="modal-header">
            <h3>Push {selectedRows.length} user_ids to segment</h3>
            <p>Selection from <span className="mono" style={{ fontSize: 12 }}>mf_users.user_id</span> · scoped to current query.</p>
          </div>
          <div className="modal-body">
            <div className="tabs" style={{ width: '100%', display: 'flex' }}>
              <button className={`${mode === 'new' ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setMode('new')}>Create new</button>
              <button className={`${mode === 'append' ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setMode('append')}>Append to existing</button>
            </div>
            <div style={{ height: 14 }}/>
            {mode === 'new' ? (
              <>
                <FieldLabel>Name</FieldLabel>
                <div className="input" style={{ height: 34 }}>
                  <input value={name} onChange={(e) => setName(e.target.value)}/>
                </div>
                <div style={{ height: 10 }}/>
                <SegSummary count={selectedRows.length} summary={summary} compact/>
              </>
            ) : (
              <>
                <FieldLabel>Target segment</FieldLabel>
                <select className="select" style={{ width: '100%' }} value={appendTo} onChange={(e) => setAppendTo(e.target.value)}>
                  {SEGMENTS.filter(s => !s.live).map(s => (
                    <option key={s.id} value={s.id}>{s.name} · {fmtInt(s.size)} ids</option>
                  ))}
                </select>
                <div style={{ height: 8 }}/>
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>Only static segments are listed — live ones rebuild from their predicate.</p>
              </>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-brand" onClick={() => onConfirm(mode === 'new' ? 'seg.ad_hoc_2305' : appendTo)}>
              <Icon name="check" size={13}/>
              {mode === 'new' ? 'Create segment' : 'Append'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ────────── Selection summary (used by sheet + modal) ──────────
function SegSummary({ count, summary, compact }) {
  if (!summary) return null;
  return (
    <div style={{ background: 'var(--neutral-50)', border: '1px solid var(--border-card)', borderRadius: 10, padding: 12 }}>
      <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: compact ? 22 : 28, fontWeight: 600, letterSpacing: '-0.02em', fontFeatureSettings: '"tnum"' }}>{count}</span>
        <span className="muted" style={{ fontSize: 12 }}>user_ids · avg ARPU {fmtVnd(summary.avgArpu)} VND</span>
      </div>
      {!compact && (
        <div className="row" style={{ gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
          <Mini label="Country" items={summary.countries.slice(0, 3)}/>
          <Mini label="Tier"    items={summary.tiers.slice(0, 3)}/>
          <Mini label="Channel" items={summary.channels.slice(0, 3)}/>
        </div>
      )}
    </div>
  );
}

function Mini({ label, items }) {
  return (
    <div style={{ minWidth: 88 }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{label}</div>
      <div className="col" style={{ gap: 2 }}>
        {items.map(([k, v]) => (
          <div key={k} className="row" style={{ gap: 6, fontSize: 12 }}>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{k}</span>
            <span className="muted">· {v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldLabel({ children }) {
  return <label style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{children}</label>;
}

// ────────── Post-push toast ──────────
function PushedToast({ segId, onView, onClose }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--neutral-900)', color: 'white',
      padding: '12px 14px', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'center',
      boxShadow: 'var(--shadow-lg)', zIndex: 80,
      animation: 'toastIn 200ms cubic-bezier(.4,0,.2,1)',
    }}>
      <span style={{
        width: 26, height: 26, borderRadius: 999, background: 'var(--success)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}><Icon name="check" size={14} stroke={3}/></span>
      <div style={{ fontSize: 13 }}>
        <div style={{ fontWeight: 600 }}>Segment created</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Saved to your library · ready for analysis</div>
      </div>
      <button className="btn btn-sm" style={{ background: 'var(--brand)', color: 'white', borderColor: 'var(--brand)' }} onClick={onView}>
        View segment <Icon name="arrow-right" size={12}/>
      </button>
      <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ color: 'rgba(255,255,255,0.6)' }} aria-label="Dismiss"><Icon name="x" size={12}/></button>
    </div>
  );
}

window.PlaygroundScreen = PlaygroundScreen;
