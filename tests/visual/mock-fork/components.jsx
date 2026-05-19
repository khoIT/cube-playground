// Shared atoms — icons (Lucide), buttons, badges, charts, header.

const { useEffect, useState, useRef, useMemo, useCallback } = React;

// Inline SVG icon — uses currentColor and inherits sizing. Library is a flat subset of Lucide.
function Icon({ name, size = 14, stroke = 2, style }) {
  const paths = ICONS[name];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="icon"
      style={style}
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

// Minimal Lucide subset, hand-traced.
const ICONS = {
  'plus':              <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  'minus':             <path d="M5 12h14"/>,
  'x':                 <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>,
  'check':             <path d="M20 6 9 17l-5-5"/>,
  'chevron-right':     <path d="m9 18 6-6-6-6"/>,
  'chevron-left':      <path d="m15 18-6-6 6-6"/>,
  'chevron-down':      <path d="m6 9 6 6 6-6"/>,
  'chevron-up':        <path d="m18 15-6-6-6 6"/>,
  'arrow-right':       <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>,
  'arrow-up':          <><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></>,
  'arrow-down':        <><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></>,
  'arrow-up-right':    <><path d="M7 7h10v10"/><path d="M7 17 17 7"/></>,
  'arrow-left':        <><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></>,
  'search':            <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>,
  'sliders':           <><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="2" y1="14" x2="6" y2="14"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="18" y1="16" x2="22" y2="16"/></>,
  'filter':            <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>,
  'play':              <polygon points="6 3 20 12 6 21 6 3"/>,
  'pause':             <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>,
  'more-horizontal':   <><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>,
  'more-vertical':     <><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></>,
  'copy':              <><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  'trash':             <><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>,
  'download':          <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
  'upload':            <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
  'save':              <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></>,
  'sparkles':          <><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></>,
  'users':             <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
  'user':              <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
  'circle-user-round': <><circle cx="12" cy="12" r="10"/><path d="M7 20.66a9 9 0 0 1 10 0"/><circle cx="12" cy="10" r="4"/></>,
  'calendar-clock':    <><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><circle cx="16" cy="16" r="6"/><path d="M16 14v2l1 1"/></>,
  'wallet':            <><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></>,
  'receipt':           <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/></>,
  'layers':            <><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>,
  'book-open':         <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></>,
  'layout-dashboard':  <><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></>,
  'target':            <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
  'refresh':           <><path d="M21 12a9 9 0 0 0-15-6.7L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15 6.7L21 16"/><path d="M21 21v-5h-5"/></>,
  'send':              <><path d="m22 2-7 20-4-9-9-4 20-7z"/><path d="M22 2 11 13"/></>,
  'send-to-back':      <><rect x="14" y="14" width="8" height="8" rx="2"/><rect x="2" y="2" width="8" height="8" rx="2"/><path d="M7 14v1a2 2 0 0 0 2 2h1"/><path d="M14 7h1a2 2 0 0 1 2 2v1"/></>,
  'check-circle':      <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>,
  'circle':            <circle cx="12" cy="12" r="10"/>,
  'globe':             <><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/></>,
  'cpu':               <><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></>,
  'trending-up':       <><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></>,
  'trending-down':     <><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></>,
  'pencil':            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>,
  'eye':               <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
  'external-link':     <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></>,
  'database':          <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></>,
  'zap':               <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>,
  'tag':               <><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></>,
  'history':           <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></>,
  'settings':          <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  'lock':              <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
  'columns':           <><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></>,
  'list-tree':         <><path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v12"/><path d="M3 12h2"/><path d="M3 6h2"/><path d="M3 18h2"/></>,
};

// Format helpers
const fmtInt = (n) => n.toLocaleString('en-US');
const fmtVnd = (n) => {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
};
const fmtPct = (n, frac = 1) => (n * 100).toFixed(frac) + '%';
const fmtDelta = (n) => {
  if (n == null) return null;
  const pct = (n * 100).toFixed(1);
  return (n >= 0 ? '+' : '') + pct + '%';
};

// Sparkline
function Sparkline({ data, color = 'var(--brand)', width = 80, height = 22 }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / range) * (height - 4)).toFixed(1)}`).join(' ');
  const last = data[data.length - 1];
  const lastX = (data.length - 1) * step;
  const lastY = height - 2 - ((last - min) / range) * (height - 4);
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={points} stroke={color} strokeWidth="1.5" fill="none" />
      <circle cx={lastX} cy={lastY} r="1.8" fill={color} />
    </svg>
  );
}

// Avatar
function Avatar({ name, color, size = 22 }) {
  const initials = name ? name.slice(0, 1).toUpperCase() : '?';
  return (
    <span
      className="avatar"
      style={{ background: color || 'var(--neutral-400)', width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >{initials}</span>
  );
}

// Live / Static badge
function LiveBadge({ live, refresh }) {
  if (!live) {
    return <span className="badge badge-static"><Icon name="lock" size={11} stroke={2}/>Static</span>;
  }
  return (
    <span className="badge badge-live">
      <span className="dot"/>Live · {refresh}
    </span>
  );
}

// Header
function Header({ tab, onTab }) {
  const tabs = [
    { id: 'playground', label: 'Playground', icon: 'layout-dashboard' },
    { id: 'segments',   label: 'Segments',   icon: 'users' },
    { id: 'metrics',    label: 'New metric', icon: 'sparkles' },
    { id: 'catalog',    label: 'Catalog',    icon: 'book-open' },
  ];
  return (
    <header className="app-header">
      <div className="brand-block">
        <span className="brand-mark">G</span>
        <span className="brand-name">GDS Cube <span className="muted">· Ballistar VN</span></span>
      </div>
      <nav className="nav-pills">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`nav-pill${tab === t.id ? ' active' : ''}`}
            onClick={() => onTab(t.id)}
          >
            <Icon name={t.icon} size={14}/>{t.label}
          </button>
        ))}
      </nav>
      <div className="header-spacer"/>
      <div className="header-right">
        <span className="header-chip"><span className="dot"/>cube-api · v1.0</span>
        <button className="btn btn-ghost btn-sm" aria-label="Settings"><Icon name="settings" size={14}/></button>
        <span className="header-avatar">MQ</span>
      </div>
    </header>
  );
}

// Color helpers for distribution charts
const PALETTE = ['#f05a22', '#3f8dff', '#0891b2', '#10b981', '#a855f7', '#f59e0b', '#ef4444', '#737373', '#7c2d12', '#1d4ed8'];

// Donut chart for a small (≤6 slice) composition.
function Donut({ data, size = 132, thickness = 18 }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2 - thickness / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--neutral-100)" strokeWidth={thickness} />
      {data.map((d, i) => {
        const len = (d.value / total) * c;
        const color = d.color || PALETTE[i % PALETTE.length];
        const dash = `${len} ${c - len}`;
        const seg = (
          <circle
            key={i}
            cx={size/2}
            cy={size/2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeDasharray={dash}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size/2} ${size/2})`}
            strokeLinecap="butt"
          />
        );
        offset += len;
        return seg;
      })}
    </svg>
  );
}

// Composition bar — full-width stacked bar with legend.
function StackedBar({ data, valueKey = 'value' }) {
  const total = data.reduce((s, d) => s + d[valueKey], 0);
  return (
    <>
      <div className="hbar">
        {data.map((d, i) => {
          const color = d.color || PALETTE[i % PALETTE.length];
          const pct = (d[valueKey] / total) * 100;
          return <div key={i} className="hbar-seg" style={{ width: `${pct}%`, background: color }} title={`${d.label} — ${pct.toFixed(1)}%`}/>;
        })}
      </div>
      <div className="hbar-legend">
        {data.map((d, i) => {
          const color = d.color || PALETTE[i % PALETTE.length];
          const pct = ((d[valueKey] / total) * 100).toFixed(1);
          return (
            <span key={i} className="item">
              <span className="sw" style={{ background: color }}/>
              {d.label}
              <span className="pct">{pct}%</span>
            </span>
          );
        })}
      </div>
    </>
  );
}

// Line chart
function LineChart({ data, xKey, yKey, color = 'var(--brand)', height = 120, format = fmtInt, fill = true }) {
  const ref = useRef(null);
  const [w, setW] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const PAD_L = 38, PAD_R = 8, PAD_T = 8, PAD_B = 22;
  const innerW = w - PAD_L - PAD_R;
  const innerH = height - PAD_T - PAD_B;
  const ys = data.map(d => d[yKey]);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const range = (max - min) || 1;
  const yMin = min - range * 0.1;
  const yMax = max + range * 0.1;
  const yRange = (yMax - yMin) || 1;
  const stepX = innerW / (data.length - 1);
  const pts = data.map((d, i) => [PAD_L + i * stepX, PAD_T + innerH - ((d[yKey] - yMin) / yRange) * innerH]);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L ${pts[pts.length-1][0].toFixed(1)} ${(PAD_T + innerH).toFixed(1)} L ${pts[0][0].toFixed(1)} ${(PAD_T + innerH).toFixed(1)} Z`;
  // Y-axis ticks
  const ticks = [yMax, (yMax + yMin) / 2, yMin];
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${w} ${height}`} width={w} height={height}>
        <defs>
          <linearGradient id={`grad-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD_L} x2={w - PAD_R}
              y1={(PAD_T + (i / 2) * innerH).toFixed(1)}
              y2={(PAD_T + (i / 2) * innerH).toFixed(1)}
              stroke="var(--neutral-100)"
            />
            <text x={PAD_L - 6} y={(PAD_T + (i / 2) * innerH + 3).toFixed(1)} fontSize="10" textAnchor="end" fill="var(--text-muted)" fontFamily="var(--font-mono)">
              {format(t)}
            </text>
          </g>
        ))}
        {fill && <path d={area} fill={`url(#grad-${color.replace(/[^a-z0-9]/gi, '')})`} />}
        <path d={line} fill="none" stroke={color} strokeWidth="2"/>
        {data.map((d, i) => (
          <circle key={i} cx={pts[i][0]} cy={pts[i][1]} r="2.5" fill={color}/>
        ))}
        {/* X labels — first / mid / last */}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
          <text key={i} x={pts[i][0]} y={height - 5} fontSize="10" textAnchor="middle" fill="var(--text-muted)">
            {data[i][xKey]}
          </text>
        ))}
      </svg>
    </div>
  );
}

// Bar list (used for retention etc)
function BarList({ rows, max, valueFmt = fmtInt, suffix }) {
  const m = max ?? Math.max(...rows.map(r => r.value));
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} className="bar-chart-row">
          <span className="label">{r.label}</span>
          <div className="bar-bg">
            <div className="bar-fill" style={{ width: `${(r.value / m) * 100}%`, background: r.color || 'var(--brand)' }}/>
          </div>
          <span className="meta">
            <strong>{valueFmt(r.value)}</strong>{suffix}
          </span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, {
  Icon, ICONS, fmtInt, fmtVnd, fmtPct, fmtDelta,
  Sparkline, Avatar, LiveBadge, Header,
  PALETTE, Donut, StackedBar, LineChart, BarList,
});
