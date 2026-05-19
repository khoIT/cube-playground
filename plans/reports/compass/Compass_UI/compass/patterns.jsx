/* global React, Icon, Badge, Button, Tooltip, Avatar */
/* Compass cross-surface patterns. These appear on multiple surfaces (Catalog cards,
   Metric Detail, Explore tooltips, Digest items). One canonical treatment each. */

const { useState: useStateP } = React;

// -------- Trust state badge (certified / beta / draft / deprecated / orphaned) --------
const TRUST_STATES = {
  certified:  { icon: "shield-check", label: "Certified",  fg: "var(--trust-certified)",  bg: "var(--trust-certified-bg)",  border: "var(--trust-certified-border)"  },
  beta:       { icon: "flask-conical",label: "Beta",       fg: "var(--trust-beta)",       bg: "var(--trust-beta-bg)",       border: "var(--trust-beta-border)"       },
  draft:      { icon: "pencil-line",  label: "Draft",      fg: "var(--trust-draft)",      bg: "var(--trust-draft-bg)",      border: "var(--trust-draft-border)"      },
  deprecated: { icon: "ban",label: "Deprecated",fg: "var(--trust-deprecated)", bg: "var(--trust-deprecated-bg)", border: "var(--trust-deprecated-border)" },
  orphaned:   { icon: "help-circle",  label: "Orphaned",   fg: "var(--trust-orphaned)",   bg: "var(--trust-orphaned-bg)",   border: "var(--trust-orphaned-border)"   },
};
const TrustBadge = ({ state = "certified", prominent = "medium", style }) => {
  const s = TRUST_STATES[state];
  if (!s) return null;
  // 3 prominence levels — per PRD's "How loud is certified?" open question
  if (prominent === "quiet") {
    return (
      <Tooltip content={`${s.label} — owner-approved`}>
        <span style={{ display: "inline-flex", alignItems: "center", color: s.fg, ...style }}>
          <Icon name={s.icon} size={13} />
        </span>
      </Tooltip>
    );
  }
  if (prominent === "loud") {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px",
        background: s.bg, color: s.fg, border: `1px solid ${s.border}`, borderRadius: 6,
        fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 11, lineHeight: 1.4,
        letterSpacing: "0.02em", textTransform: "uppercase",
        ...style,
      }}>
        <Icon name={s.icon} size={11} /> {s.label}
      </span>
    );
  }
  // medium (default)
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 6px 1px 4px",
      color: s.fg, border: `1px solid ${s.border}`, background: s.bg, borderRadius: 4,
      fontFamily: "var(--font-sans)", fontWeight: 500, fontSize: 11, lineHeight: 1.4,
      ...style,
    }}>
      <Icon name={s.icon} size={11} /> {s.label}
    </span>
  );
};

// -------- Freshness chip --------
// State derived from "time since refresh" vs the cube's SLA.
const Freshness = ({ minutesAgo, sla = 60, compact, style }) => {
  let state = "ok";
  if (minutesAgo > sla) state = "stale";
  else if (minutesAgo > sla * 0.75) state = "warn";
  const map = {
    ok:    { color: "var(--fresh-ok)",    label: "Fresh" },
    warn:  { color: "var(--fresh-warn)",  label: "Aging" },
    stale: { color: "var(--fresh-stale)", label: "Stale" },
  }[state];
  const human = minutesAgo < 60 ? `${minutesAgo}m ago` : minutesAgo < 60*24 ? `${Math.floor(minutesAgo/60)}h ago` : `${Math.floor(minutesAgo/60/24)}d ago`;
  if (compact) {
    return (
      <Tooltip content={`Last refreshed ${human} · SLA ${sla}m · ${map.label}`}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--neutral-500)", fontSize: 11, fontFamily: "var(--font-sans)", ...style }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: map.color, flexShrink: 0 }} />
          {human}
        </span>
      </Tooltip>
    );
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 8px",
      borderRadius: 6, border: `1px solid var(--border)`, background: "#fff",
      fontFamily: "var(--font-sans)", fontWeight: 500, fontSize: 11, color: "var(--neutral-700)",
      ...style,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: map.color }} />
      Refreshed {human}
    </span>
  );
};

// -------- Anomaly badge --------
const ANOMALY = {
  none:  { icon: null,       fg: "var(--neutral-500)",  bg: "transparent",          border: "transparent",          label: "Normal" },
  low:   { icon: "trending-up", fg: "var(--anomaly-low)",  bg: "var(--anomaly-low-bg)",  border: "#fde68a", label: "Unusual" },
  high:  { icon: "alert-triangle", fg: "var(--anomaly-high)", bg: "var(--anomaly-high-bg)", border: "#fecaca", label: "Anomaly" },
  trend: { icon: "activity",  fg: "var(--anomaly-trend)",bg: "var(--anomaly-trend-bg)",border: "#ddd6fe", label: "Trending" },
};
const AnomalyBadge = ({ state = "none", delta, onClick, style }) => {
  if (state === "none") return null;
  const s = ANOMALY[state];
  return (
    <span onClick={onClick} title="Open change analysis" style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px",
      borderRadius: 9999, border: `1px solid ${s.border}`, background: s.bg, color: s.fg,
      fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 11, lineHeight: 1.4,
      cursor: onClick ? "pointer" : "default", ...style,
    }}>
      <Icon name={s.icon} size={11} />
      {delta != null ? (delta > 0 ? `+${delta}%` : `${delta}%`) : s.label}
    </span>
  );
};

// -------- Concept type icon + chip --------
const TYPE_INFO = {
  measure:   { icon: "sigma",       label: "Measure",   color: "var(--type-measure)",  bg: "var(--type-measure-bg)" },
  dimension: { icon: "rows-3",      label: "Dimension", color: "var(--type-dim)",      bg: "var(--type-dim-bg)" },
  segment:   { icon: "filter",      label: "Segment",   color: "var(--type-segment)",  bg: "var(--type-segment-bg)" },
  view:      { icon: "table",       label: "View",      color: "var(--type-view)",     bg: "var(--type-view-bg)" },
};
const TypeIcon = ({ type, size = 14 }) => {
  const t = TYPE_INFO[type] || TYPE_INFO.measure;
  return (
    <span style={{
      width: size + 8, height: size + 8, borderRadius: 6,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: t.bg, color: t.color, flexShrink: 0,
    }}>
      <Icon name={t.icon} size={size} />
    </span>
  );
};
const TypeChip = ({ type, size = 11 }) => {
  const t = TYPE_INFO[type] || TYPE_INFO.measure;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 6px",
      borderRadius: 4, color: t.color, background: t.bg,
      fontFamily: "var(--font-sans)", fontWeight: 500, fontSize: size,
    }}>
      <Icon name={t.icon} size={size - 1} />
      {t.label}
    </span>
  );
};

// -------- Domain chip --------
const DOMAIN_INFO = {
  revenue:     { label: "Revenue",     color: "var(--domain-revenue)",     bg: "var(--domain-revenue-bg)" },
  engagement:  { label: "Engagement",  color: "var(--domain-engagement)",  bg: "var(--domain-engagement-bg)" },
  acquisition: { label: "Acquisition", color: "var(--domain-acquisition)", bg: "var(--domain-acquisition-bg)" },
  retention:   { label: "Retention",   color: "var(--domain-retention)",   bg: "var(--domain-retention-bg)" },
  payments:    { label: "Payments",    color: "var(--domain-payments)",    bg: "var(--domain-payments-bg)" },
  concurrency: { label: "Concurrency", color: "var(--domain-concurrency)", bg: "var(--domain-concurrency-bg)" },
  marketing:   { label: "Marketing",   color: "var(--domain-marketing)",   bg: "var(--domain-marketing-bg)" },
  custom:      { label: "Custom",      color: "var(--domain-custom)",      bg: "var(--domain-custom-bg)" },
};
const DomainChip = ({ domain }) => {
  const d = DOMAIN_INFO[domain] || DOMAIN_INFO.custom;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "1px 7px",
      borderRadius: 4, color: d.color, background: d.bg,
      fontFamily: "var(--font-sans)", fontWeight: 500, fontSize: 11,
    }}>{d.label}</span>
  );
};

// -------- Drift warning --------
const DriftWarning = ({ compact, message = "This game's definition differs from canonical GDS-1.8" }) => {
  if (compact) {
    return (
      <Tooltip content={message}>
        <span style={{ display: "inline-flex", color: "var(--amber-500)" }}>
          <Icon name="git-fork" size={13} />
        </span>
      </Tooltip>
    );
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 8px",
      borderRadius: 6, border: "1px solid #fde68a", background: "#fffbeb", color: "#b45309",
      fontFamily: "var(--font-sans)", fontWeight: 500, fontSize: 11,
    }}>
      <Icon name="git-fork" size={11} /> Differs from GDS-1.8
    </span>
  );
};

// -------- Feedback widget (subtle 👍/👎) --------
const FeedbackWidget = ({ initial, onChange, compact }) => {
  const [v, setV] = useStateP(initial || null);
  const click = (next) => { const x = v === next ? null : next; setV(x); onChange?.(x); };
  const size = compact ? 12 : 14;
  return (
    <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
      <span onClick={(e) => { e.stopPropagation(); click("up"); }} style={{
        width: compact ? 20 : 24, height: compact ? 20 : 24, borderRadius: 6,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", color: v === "up" ? "var(--success)" : "var(--neutral-400)",
        background: v === "up" ? "rgba(16,185,129,0.08)" : "transparent",
      }}><Icon name="thumbs-up" size={size} /></span>
      <span onClick={(e) => { e.stopPropagation(); click("down"); }} style={{
        width: compact ? 20 : 24, height: compact ? 20 : 24, borderRadius: 6,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", color: v === "down" ? "var(--destructive)" : "var(--neutral-400)",
        background: v === "down" ? "rgba(220,38,38,0.08)" : "transparent",
      }}><Icon name="thumbs-down" size={size} /></span>
    </span>
  );
};

// -------- "Used in N places" chip --------
const UsageChip = ({ count, onClick }) => (
  <span onClick={onClick} style={{
    display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 9999,
    background: "rgba(10,10,10,0.05)", color: "var(--neutral-700)",
    fontFamily: "var(--font-sans)", fontWeight: 500, fontSize: 11,
    cursor: onClick ? "pointer" : "default",
  }}>
    <Icon name="link-2" size={11} /> Used in <b style={{ fontFamily: "var(--font-mono)" }}>{count}</b> places
  </span>
);

// -------- Owner avatar with name --------
const OwnerStamp = ({ owner, label = "Owner", compact }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    <Avatar name={owner.name} size={compact ? 16 : 20} />
    {!compact && (
      <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.2 }}>
        <span style={{ fontSize: 10, color: "var(--neutral-500)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
        <span style={{ fontSize: 12, color: "var(--neutral-900)", fontWeight: 500 }}>{owner.name}</span>
      </span>
    )}
    {compact && <span style={{ fontSize: 11, color: "var(--neutral-600)" }}>{owner.name.split(" ")[0]}</span>}
  </span>
);

// -------- Mono metric value (used everywhere for numerical display) --------
const Metric = ({ value, unit, delta, deltaPositive = true, size = "md" }) => {
  const sizes = { sm: { vfs: 18, ufs: 11 }, md: { vfs: 28, ufs: 13 }, lg: { vfs: 40, ufs: 15 } };
  const s = sizes[size];
  return (
    <div style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
      <span style={{ fontFamily: "var(--num-font)", fontWeight: 500, fontSize: s.vfs, color: "var(--neutral-950)", letterSpacing: "-0.02em" }}>{value}</span>
      {unit && <span style={{ fontFamily: "var(--font-sans)", fontSize: s.ufs, color: "var(--neutral-500)", fontWeight: 500 }}>{unit}</span>}
      {delta != null && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: s.ufs, fontFamily: "var(--font-sans)", fontWeight: 600, color: deltaPositive ? "var(--success)" : "var(--destructive)", marginLeft: 4 }}>
          <Icon name={deltaPositive ? "trending-up" : "trending-down"} size={12} />
          {delta > 0 ? "+" : ""}{delta}%
        </span>
      )}
    </div>
  );
};

// -------- Concept card (used in Catalog grid and NL search results) --------
// Variants: "grid" (catalog default), "list" (compact row), "search" (inside search dropdown), "slack" (mini for slack mock)
const ConceptCard = ({ concept, onClick, variant = "grid", trustProminence = "medium", showFeedback = true }) => {
  if (variant === "list") {
    return (
      <div onClick={onClick} style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
        background: "#fff", border: "1px solid var(--border)", borderRadius: 10, cursor: "pointer",
        transition: "border-color .15s, box-shadow .15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--neutral-300)"; e.currentTarget.style.boxShadow = "var(--shadow-xs)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}>
        <TypeIcon type={concept.type} size={14} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 13, color: "var(--neutral-950)" }}>{concept.label}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--neutral-500)" }}>{concept.cube}.{concept.member}</span>
            {concept.trust && <TrustBadge state={concept.trust} prominent="quiet" />}
            {concept.drift && <DriftWarning compact />}
          </div>
          <div style={{ fontSize: 12, color: "var(--neutral-600)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{concept.description}</div>
        </div>
        <DomainChip domain={concept.domain} />
        <Freshness minutesAgo={concept.refreshMinutes || 12} sla={concept.refreshSla || 60} compact />
        <Icon name="chevron-right" size={14} color="var(--neutral-400)" />
      </div>
    );
  }
  if (variant === "search") {
    return (
      <div onClick={onClick} style={{
        display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px",
        borderRadius: 8, cursor: "pointer", transition: "background .15s",
      }} onMouseEnter={e => e.currentTarget.style.background = "var(--neutral-50)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <TypeIcon type={concept.type} size={12} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: "var(--font-sans)", fontWeight: 500, fontSize: 13, color: "var(--neutral-950)" }}>{concept.label}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--neutral-500)" }}>{concept.cube}.{concept.member}</span>
            {concept.trust === "certified" && <TrustBadge state="certified" prominent="quiet" />}
          </div>
          <div style={{ fontSize: 12, color: "var(--neutral-500)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{concept.description}</div>
        </div>
      </div>
    );
  }
  // grid (default)
  return (
    <div onClick={onClick} style={{
      background: "#fff", border: "1px solid var(--border)", borderRadius: 12,
      padding: 14, cursor: "pointer", display: "flex", flexDirection: "column", gap: 10,
      transition: "border-color .15s, box-shadow .15s, transform .15s",
      position: "relative", minHeight: 168,
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--neutral-300)"; e.currentTarget.style.boxShadow = "var(--shadow-sm)"; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <TypeIcon type={concept.type} size={14} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 14, color: "var(--neutral-950)", letterSpacing: "-0.005em", lineHeight: 1.3 }}>{concept.label}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--neutral-500)", marginTop: 2 }}>{concept.cube}.{concept.member}</div>
        </div>
        {concept.anomaly && concept.anomaly !== "none" && (
          <AnomalyBadge state={concept.anomaly} delta={concept.delta} />
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--neutral-600)", lineHeight: 1.5, flex: 1, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{concept.description}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <DomainChip domain={concept.domain} />
        {concept.unit && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--neutral-500)", padding: "1px 6px", border: "1px solid var(--border)", borderRadius: 4 }}>{concept.unit}</span>
        )}
        {concept.drift && <DriftWarning compact />}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, borderTop: "1px solid var(--neutral-100)" }}>
        {concept.trust && <TrustBadge state={concept.trust} prominent={trustProminence} />}
        <Freshness minutesAgo={concept.refreshMinutes || 12} sla={concept.refreshSla || 60} compact />
        <span style={{ flex: 1 }} />
        {showFeedback && <FeedbackWidget compact />}
      </div>
    </div>
  );
};

Object.assign(window, {
  TrustBadge, TRUST_STATES, Freshness, AnomalyBadge, ANOMALY,
  TypeIcon, TypeChip, TYPE_INFO, DomainChip, DOMAIN_INFO,
  DriftWarning, FeedbackWidget, UsageChip, OwnerStamp, Metric, ConceptCard,
});
