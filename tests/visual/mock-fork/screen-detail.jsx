// Screen 3 — Segment detail with full breakdown by the 4 cubes.

function DetailScreen({ segId, goLibrary, goEditor, livePlacement }) {
  const seg = SEGMENTS.find(s => s.id === segId) || SEGMENTS[0];
  const d = SEGMENT_DETAIL; // mock detail; in real life keyed by seg.id
  const [activeTab, setActiveTab] = React.useState('overview');

  // Live status header treatments — driven by tweaks.
  const showHeaderPill   = livePlacement === 'header' || livePlacement === 'all';
  const showBanner       = livePlacement === 'banner' || livePlacement === 'all';
  const showFloatingChip = livePlacement === 'floating' || livePlacement === 'all';

  return (
    <div className="page">
      <div className="crumbs">
        <a onClick={(e) => { e.preventDefault(); goLibrary(); }} href="#">Segments</a>
        <span className="sep">/</span>
        <span style={{ color: 'var(--text-primary)' }}>{seg.name}</span>
      </div>

      <div className="page-title-row">
        <div className="grow">
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <h1 className="page-title" style={{ margin: 0 }}>{seg.name}</h1>
            {showHeaderPill && <LiveBadge live={seg.live} refresh={seg.refresh}/>}
            <span className="tag" style={{ height: 22, padding: '0 8px', fontSize: 11.5 }}>
              <Icon name="database" size={11} style={{ marginRight: 4 }}/>{seg.cube}
            </span>
          </div>
          <p className="page-subtitle" style={{ marginTop: 6 }}>{seg.description}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn"><Icon name="download" size={13}/>Export IDs</button>
          <button className="btn"><Icon name="copy" size={13}/>Copy as filter</button>
          <button className="btn btn-primary" onClick={() => goEditor(seg.id)}>
            <Icon name="pencil" size={13}/>Edit predicate
          </button>
          <button className="btn btn-ghost btn-sm" aria-label="More"><Icon name="more-horizontal" size={14}/></button>
        </div>
      </div>

      {/* Live banner */}
      {showBanner && seg.live && (
        <div className="live-banner" style={{ marginBottom: 16 }}>
          <span className="dot"/>
          <div>
            <strong>Live segment</strong> · refreshes every <strong>{seg.refresh}</strong> from the predicate below.
            <span className="muted" style={{ marginLeft: 8, color: 'var(--live-badge-text)', opacity: 0.7 }}>
              Last refresh {seg.updated} · next in <span className="mono">{seg.nextRefresh}</span>
            </span>
          </div>
          <div className="grow"/>
          <button className="btn btn-sm" style={{ background: 'white', borderColor: 'var(--live-badge-border)', color: 'var(--live-badge-text)' }}>
            <Icon name="refresh" size={12}/>Refresh now
          </button>
        </div>
      )}

      {/* Headline KPIs */}
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi label="Segment size" value={fmtInt(seg.size)} unit="user_ids" delta={seg.sizeDelta} foot={`vs 14d ago`} />
        <Kpi label="DAU" value={fmtInt(d.engagement.dau_14d[d.engagement.dau_14d.length-1].dau)} unit="active today" delta={0.018} foot="mf_users ∩ active_daily" sub="active_daily.dau_exact"/>
        <Kpi label="ARPU (lifetime)" value={fmtVnd(d.monetization.arpu_vnd)} unit="VND" delta={0.041} foot="vs prev period" sub="mf_users.arpu_vnd"/>
        <Kpi label="Revenue (30d)" value={fmtVnd(d.monetization.revenue_30d_vnd)} unit="VND" delta={d.monetization.revenue_30d_delta} foot="user_recharge_daily" sub="revenue_vnd_total"/>
      </div>

      {/* Section tabs */}
      <div className="tabs" style={{ marginBottom: 14 }}>
        {[
          { id: 'overview',    label: 'Overview' },
          { id: 'engagement',  label: 'Engagement' },
          { id: 'monetization',label: 'Monetization' },
          { id: 'retention',   label: 'Retention' },
          { id: 'users',       label: `Sample users · ${d.sample_users.length}` },
          { id: 'predicate',   label: 'Predicate' },
        ].map(t => (
          <button key={t.id} className={activeTab === t.id ? 'active' : ''} onClick={() => setActiveTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {activeTab === 'overview'     && <OverviewTab detail={d} segment={seg}/>}
      {activeTab === 'engagement'   && <EngagementTab detail={d}/>}
      {activeTab === 'monetization' && <MonetizationTab detail={d}/>}
      {activeTab === 'retention'    && <RetentionTab detail={d}/>}
      {activeTab === 'users'        && <UsersTab detail={d}/>}
      {activeTab === 'predicate'    && <PredicateReadOnly segment={seg}/>}

      {showFloatingChip && seg.live && <FloatingLiveChip seg={seg}/>}
    </div>
  );
}

// ────────── KPI tile (segment-detail variant) ──────────
function Kpi({ label, value, unit, delta, foot, sub }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
        <span className="value">{value}<span className="unit"> {unit}</span></span>
      </div>
      <div className="row" style={{ marginTop: 6, gap: 8, flexWrap: 'wrap' }}>
        {delta != null && (
          <span className={`delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}`}>
            <Icon name={delta > 0 ? 'arrow-up' : 'arrow-down'} size={10}/>{fmtDelta(delta)}
          </span>
        )}
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{foot}</span>
      </div>
      {sub && (
        <div className="member-pill measure" style={{ marginTop: 8, fontSize: 11 }}>{sub}</div>
      )}
    </div>
  );
}

// ────────── Overview tab — composition + headline charts ──────────
function OverviewTab({ detail, segment }) {
  const d = detail;
  return (
    <>
      <div className="grid-3" style={{ marginBottom: 16 }}>
        <CompositionCard
          title="Channel"
          cube="mf_users.channel"
          data={d.identity.channel}
        />
        <CompositionCard
          title="Platform"
          cube="mf_users.platform"
          data={d.identity.platform}
        />
        <CompositionCard
          title="Country"
          cube="mf_users.country"
          data={d.identity.country}
          collapsed
        />
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">
            <div className="left">
              <Icon name="calendar-clock" size={14} style={{ color: 'var(--qb-time-text)' }}/>
              <h3>DAU · last 14 days</h3>
              <span className="badge badge-measure">active_daily.dau_exact</span>
            </div>
            <span className="sub">stickiness {fmtPct(d.engagement.stickiness)}</span>
          </div>
          <div style={{ padding: '14px 16px' }}>
            <LineChart data={d.engagement.dau_14d} xKey="d" yKey="dau" height={150} color="var(--brand)"/>
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <div className="left">
              <Icon name="wallet" size={14} style={{ color: 'var(--qb-measure-text)' }}/>
              <h3>Revenue · last 14 days (VND, M)</h3>
              <span className="badge badge-measure">user_recharge_daily.revenue_vnd_total</span>
            </div>
            <span className="sub">{fmtDelta(d.monetization.revenue_30d_delta)} vs 14d prior</span>
          </div>
          <div style={{ padding: '14px 16px' }}>
            <LineChart data={d.monetization.revenue_14d} xKey="d" yKey="vnd" height={150} color="#3f8dff" format={(n) => fmtVnd(n * 1e6)}/>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <PaymentMethodCard detail={d}/>
        <RetentionCurveCard detail={d}/>
      </div>
    </>
  );
}

function CompositionCard({ title, cube, data, collapsed }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="left">
          <Icon name="circle-user-round" size={14} style={{ color: 'var(--qb-dimension-text)' }}/>
          <h3>{title}</h3>
        </div>
        <span className="badge badge-dimension">{cube}</span>
      </div>
      <div style={{ padding: 16 }}>
        {collapsed ? (
          <>
            <div className="row" style={{ gap: 12, marginBottom: 10 }}>
              <Donut data={data} size={104} thickness={14}/>
              <div className="col" style={{ flex: 1, gap: 6 }}>
                <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>{data[0].label}</div>
                <span className="muted" style={{ fontSize: 12 }}>Single-country segment</span>
                <span className="member-pill dimension" style={{ fontSize: 11, marginTop: 4 }}>country = {data[0].label}</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="row" style={{ gap: 12, marginBottom: 12 }}>
              <Donut data={data} size={88} thickness={12}/>
              <div className="col" style={{ gap: 2, flex: 1 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Top</span>
                <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{data[0].label}</span>
                <span className="muted" style={{ fontSize: 12 }}>{fmtPct(data[0].pct)} · {fmtInt(data[0].value)} users</span>
              </div>
            </div>
            <BarList rows={data.slice(0, 6).map((d, i) => ({ ...d, color: PALETTE[i % PALETTE.length] }))} suffix={null}/>
          </>
        )}
      </div>
    </div>
  );
}

function PaymentMethodCard({ detail }) {
  const data = detail.monetization.payment_method;
  return (
    <div className="card">
      <div className="card-header">
        <div className="left">
          <Icon name="receipt" size={14} style={{ color: 'var(--qb-measure-text)' }}/>
          <h3>Revenue by payment method · 30d</h3>
          <span className="badge badge-dimension">recharge.payment_method</span>
        </div>
      </div>
      <div style={{ padding: 16 }}>
        <BarList
          rows={data.map((d, i) => ({ label: d.label, value: d.vnd, color: PALETTE[i % PALETTE.length] }))}
          valueFmt={(n) => fmtVnd(n) + ' VND'}
        />
        <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          From <span className="mono">recharge</span> joined to <span className="mono">mf_users</span> on user_id.
          Use this when slicing on a per-transaction attribute (method, role).
        </div>
      </div>
    </div>
  );
}

function RetentionCurveCard({ detail }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="left">
          <Icon name="history" size={14} style={{ color: 'var(--qb-time-text)' }}/>
          <h3>Retention since first active</h3>
          <span className="badge badge-time">mf_users.first_active_date</span>
        </div>
        <span className="sub">D30 retention {fmtPct(detail.retention.curve[5].pct)}</span>
      </div>
      <div style={{ padding: 16 }}>
        <LineChart
          data={detail.retention.curve}
          xKey="day"
          yKey="pct"
          height={140}
          color="var(--success)"
          format={(n) => (n * 100).toFixed(0) + '%'}
        />
      </div>
    </div>
  );
}

// ────────── Engagement tab ──────────
function EngagementTab({ detail }) {
  return (
    <>
      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Kpi label="DAU today"           value={fmtInt(detail.engagement.dau_14d[detail.engagement.dau_14d.length - 1].dau)} unit="active" delta={0.018} foot="active_daily" sub="active_daily.dau_exact"/>
        <Kpi label="MAU (30d)"           value={fmtInt(detail.engagement.mau_30d)} unit="users" delta={0.011} foot="active_daily · granularity month" sub="active_daily.mau"/>
        <Kpi label="Stickiness · DAU/MAU" value={fmtPct(detail.engagement.stickiness)} unit="" delta={0.013} foot="rolling 30d"/>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="left">
            <Icon name="trending-up" size={14}/>
            <h3>Daily active users · 14d</h3>
            <span className="badge badge-measure">active_daily.dau_exact</span>
          </div>
        </div>
        <div style={{ padding: 20 }}>
          <LineChart data={detail.engagement.dau_14d} xKey="d" yKey="dau" height={220} color="var(--brand)"/>
        </div>
      </div>
      <div className="card">
        <div className="card-header">
          <div className="left">
            <Icon name="calendar-clock" size={14}/>
            <h3>Session intensity</h3>
            <span className="badge badge-dimension">active_daily.log_date</span>
          </div>
        </div>
        <div style={{ padding: 20 }}>
          <BarList
            rows={[
              { label: '1 session', value: 0.18 * detail.engagement.mau_30d },
              { label: '2–4 sessions', value: 0.32 * detail.engagement.mau_30d, color: '#3f8dff' },
              { label: '5–14 sessions', value: 0.28 * detail.engagement.mau_30d, color: '#10b981' },
              { label: '15–30 sessions', value: 0.14 * detail.engagement.mau_30d, color: '#f59e0b' },
              { label: '> 30 sessions', value: 0.08 * detail.engagement.mau_30d, color: '#a855f7' },
            ]}
            valueFmt={(n) => fmtInt(Math.round(n))}
            suffix=" users"
          />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 12 }}>
            Avg sessions per user (last 30d): <strong style={{ color: 'var(--text-primary)' }}>{detail.engagement.avg_sessions_per_user_30d}</strong>
          </div>
        </div>
      </div>
    </>
  );
}

// ────────── Monetization tab ──────────
function MonetizationTab({ detail }) {
  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Kpi label="Revenue · 30d"   value={fmtVnd(detail.monetization.revenue_30d_vnd)} unit="VND" delta={detail.monetization.revenue_30d_delta} foot="user_recharge_daily"  sub="revenue_vnd_total"/>
        <Kpi label="ARPU · lifetime" value={fmtVnd(detail.monetization.arpu_vnd)}    unit="VND" delta={0.041} foot="mf_users (hub)"             sub="mf_users.arpu_vnd"/>
        <Kpi label="ARPPU · period"  value={fmtVnd(detail.monetization.arppu_vnd)}   unit="VND" delta={0.038} foot="recharge"                  sub="recharge.arppu_vnd"/>
        <Kpi label="Paying rate"     value={fmtPct(detail.monetization.paying_rate, 0)} unit="" delta={0}     foot="100% — whales segment"      sub="mf_users.paying_rate"/>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="left">
            <Icon name="trending-up" size={14}/>
            <h3>Revenue · 14d (VND, M)</h3>
            <span className="badge badge-measure">user_recharge_daily.revenue_vnd_total</span>
          </div>
        </div>
        <div style={{ padding: 20 }}>
          <LineChart data={detail.monetization.revenue_14d} xKey="d" yKey="vnd" height={220} color="#3f8dff" format={(n) => fmtVnd(n * 1e6)}/>
        </div>
      </div>
      <PaymentMethodCard detail={detail}/>
    </>
  );
}

// ────────── Retention tab ──────────
function RetentionTab({ detail }) {
  return (
    <>
      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Kpi label="D7 retention"  value={fmtPct(detail.retention.curve[3].pct, 0)} unit="" delta={0.022} foot="active_daily ∩ mf_users"/>
        <Kpi label="D30 retention" value={fmtPct(detail.retention.curve[5].pct, 0)} unit="" delta={0.018} foot="active_daily ∩ mf_users"/>
        <Kpi label="Median tenure (days since first active)" value={detail.retention.days_since_first_active_median} unit="days" delta={null} foot="mf_users.first_active_date"/>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div className="left">
              <Icon name="history" size={14}/>
              <h3>Retention curve · since first active</h3>
              <span className="badge badge-time">mf_users.first_active_date</span>
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <LineChart data={detail.retention.curve} xKey="day" yKey="pct" height={220} color="var(--success)" format={(n) => (n*100).toFixed(0) + '%'}/>
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <div className="left">
              <Icon name="users" size={14}/>
              <h3>First-active cohort distribution</h3>
              <span className="badge badge-time">mf_users.first_active_date</span>
            </div>
          </div>
          <div style={{ padding: 20 }}>
            <BarList
              rows={detail.retention.first_active_buckets.map((b, i) => ({ ...b, color: PALETTE[i % PALETTE.length] }))}
              suffix=" users"
            />
          </div>
        </div>
      </div>
    </>
  );
}

// ────────── Sample users tab ──────────
function UsersTab({ detail }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="left">
          <Icon name="users" size={14}/>
          <h3>Sample users · {detail.sample_users.length} of {fmtInt(SEGMENTS.find(s => s.id === detail.id).size)}</h3>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm"><Icon name="download" size={12}/>Export all IDs</button>
          <button className="btn btn-sm"><Icon name="refresh" size={12}/>Reshuffle</button>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>user_id</th>
              <th>country</th>
              <th>channel</th>
              <th>platform</th>
              <th className="num">arpu_vnd</th>
              <th>last_active</th>
              <th>first_recharge</th>
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {detail.sample_users.map((r) => (
              <tr key={r.user_id}>
                <td className="mono">{r.user_id}</td>
                <td>{r.country}</td>
                <td>{r.channel}</td>
                <td>{r.platform}</td>
                <td className="num mono">{fmtVnd(r.arpu_vnd)}</td>
                <td className="mono" style={{ color: 'var(--text-muted)' }}>{r.last_active}</td>
                <td className="mono" style={{ color: 'var(--text-muted)' }}>{r.first_recharge}</td>
                <td>
                  <button className="btn btn-ghost btn-sm" aria-label="Inspect user"><Icon name="external-link" size={12}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────── Predicate read-only ──────────
function PredicateReadOnly({ segment }) {
  if (!segment.predicate) {
    return (
      <div className="card card-pad">
        <div className="row" style={{ gap: 8 }}>
          <Icon name="lock" size={14}/>
          <strong>Static segment</strong>
          <span className="muted">· no predicate. {fmtInt(segment.size)} user-ids stored as a frozen list.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="card">
      <div className="card-header">
        <div className="left">
          <Icon name="filter" size={14}/>
          <h3>Predicate</h3>
          <span className="badge badge-segment">{segment.cube}</span>
        </div>
        <button className="btn btn-sm"><Icon name="pencil" size={12}/>Edit</button>
      </div>
      <div style={{ padding: 16 }}>
        <PredicateView node={segment.predicate} depth={0}/>
        <div className="divider"/>
        <div className="muted" style={{ fontSize: 12 }}>
          <Icon name="cpu" size={12} style={{ verticalAlign: '-2px', marginRight: 6 }}/>
          Compiles to SQL via Cube → resolves <strong style={{ color: 'var(--text-primary)' }}>{fmtInt(segment.size)} user_ids</strong> from <span className="mono">mf_users</span>.
        </div>
      </div>
    </div>
  );
}

function PredicateView({ node, depth }) {
  if (node.kind === 'leaf') {
    return (
      <div className="leaf-row" style={{ gridTemplateColumns: 'auto auto 1fr', padding: '4px 0' }}>
        <span className="member-pill dimension" style={{ fontSize: 12 }}>{node.column}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{node.op}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{Array.isArray(node.value) ? node.value.join(', ') : String(node.value)}</span>
      </div>
    );
  }
  return (
    <div className="predicate" style={{ marginLeft: depth ? 16 : 0, marginBottom: 8, background: depth ? 'var(--neutral-50)' : '#fcfcfc' }}>
      <div className="group-bar">
        <span>{node.kind}</span>
      </div>
      {node.children.map((c, i) => <PredicateView key={i} node={c} depth={depth + 1}/>)}
    </div>
  );
}

// ────────── Floating live chip ──────────
function FloatingLiveChip({ seg }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24,
      background: 'var(--bg-card)',
      border: '1px solid var(--live-badge-border)',
      borderRadius: 14,
      padding: '10px 14px',
      boxShadow: 'var(--shadow-md)',
      display: 'flex', alignItems: 'center', gap: 10,
      zIndex: 30,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: 999, background: 'var(--live-badge-dot)',
        boxShadow: '0 0 0 4px rgba(16, 185, 129, 0.2)',
        animation: 'pulse 2s ease-in-out infinite',
      }}/>
      <div style={{ fontSize: 12 }}>
        <div style={{ fontWeight: 600 }}>Live · refreshes every {seg.refresh}</div>
        <div className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>next in {seg.nextRefresh}</div>
      </div>
      <button className="btn btn-sm btn-ghost" aria-label="Refresh now"><Icon name="refresh" size={12}/></button>
    </div>
  );
}

window.DetailScreen = DetailScreen;
