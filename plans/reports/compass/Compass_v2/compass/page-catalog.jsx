/* global React, Icon, Button, Badge, Input, Tabs, Tooltip, Popover, ConceptCard, MetricCard, Avatar,
   OWNERS, METRICS, CONCEPTS, CUBES, TIER_INFO, TypeIcon, DomainChip, DOMAIN_INFO, TYPE_INFO,
   TierBadge, LayerBadge, useNav, useGlobalSearch */
/* Compass — Catalog page. Two-layer architecture (PRD §1.1):
   • Metrics tab     — named business metrics (consumer surface, DEFAULT)
   • Data Model tab  — measures + dimensions + segments (author surface) */

const { useState: useStateC, useMemo: useMemoC } = React;

const CatalogPage = ({ tweaks }) => {
  const { go } = useNav();
  const [layer, setLayer] = useStateC("metric");   // "metric" | "data"
  return (
    <div style={{ padding: "24px 28px 60px", maxWidth: 1480, margin: "0 auto" }}>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 14, gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 22, color: "var(--neutral-950)", margin: 0, letterSpacing: "-0.02em" }}>Catalog</h1>
          <div style={{ fontSize: 13, color: "var(--neutral-600)", marginTop: 4, maxWidth: 720 }}>
            Two layers, one product. Browse business metrics; drill into the building blocks they compose.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button variant="outline" size="sm" leftIcon="git-fork" onClick={() => {}}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              GDS-1.8 <Badge variant="info" style={{ fontSize: 10 }}>seed reference</Badge>
            </span>
          </Button>
          <Button variant="primary" size="sm" leftIcon="plus" onClick={() => go({ name: "wizard", layer })}>{layer === "metric" ? "New metric" : "New building block"}</Button>
        </div>
      </div>

      {/* Top-level layer tabs — the central change of this revision */}
      <LayerTabs layer={layer} onChange={setLayer} />

      {/* Import-in-progress banner (Metrics tab only) */}
      {layer === "metric" && <ImportBanner />}

      {layer === "metric" ? <MetricsTab tweaks={tweaks} /> : <DataModelTab tweaks={tweaks} />}
    </div>
  );
};

// ─── Layer tabs (top-level) ────────────────────────────────────────
const LayerTabs = ({ layer, onChange }) => {
  const tabs = [
    { value: "metric", label: "Metrics",     subtitle: "Business KPIs you ask for", icon: "function-square", accent: "var(--layer-metric-accent)", count: METRICS.length },
    { value: "data",   label: "Data Model",  subtitle: "Measures, dimensions, segments",    icon: "database",        accent: "var(--layer-data-accent)",   count: CONCEPTS.length },
  ];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18,
    }}>
      {tabs.map(t => {
        const active = layer === t.value;
        return (
          <div key={t.value} onClick={() => onChange(t.value)} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
            background: "#fff", borderRadius: 12, cursor: "pointer",
            border: `1px solid ${active ? t.accent : "var(--border)"}`,
            boxShadow: active ? `0 0 0 3px ${t.accent}1a, var(--shadow-xs)` : "none",
            transition: "border-color .15s, box-shadow .15s",
            position: "relative",
          }}
          onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = "var(--neutral-300)"; }}
          onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = "var(--border)"; }}>
            <span style={{
              width: 36, height: 36, borderRadius: 8,
              background: active ? t.accent : "var(--neutral-100)",
              color: active ? "#fff" : "var(--neutral-700)",
              display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Icon name={t.icon} size={18} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 15, color: "var(--neutral-950)" }}>{t.label}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--neutral-500)" }}>{t.count}</span>
                {active && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: t.accent, textTransform: "uppercase", letterSpacing: "0.06em" }}>Active</span>}
              </div>
              <div style={{ fontSize: 12, color: "var(--neutral-500)", marginTop: 2 }}>{t.subtitle}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
//  METRICS TAB  —  named business metrics from the metric registry.
// ═══════════════════════════════════════════════════════════════════════════
const MetricsTab = ({ tweaks }) => {
  const { go } = useNav();
  const { setOpen: openSearch } = useGlobalSearch();
  const [view, setView] = useStateC("grid");
  const [q, setQ] = useStateC("");
  const [filters, setFilters] = useStateC({
    domains: new Set(),
    trust: new Set(),
    owners: new Set(),
    tiers: new Set(),
    parameterised: false,        // family-toggle per PRD
    showBlocked: false,           // surface Tier 4–6 too
  });

  const filtered = useMemoC(() => {
    let out = METRICS.slice();
    if (filters.domains.size) out = out.filter(m => filters.domains.has(m.domain));
    if (filters.trust.size)   out = out.filter(m => filters.trust.has(m.trust));
    if (filters.owners.size)  out = out.filter(m => filters.owners.has(m.owner));
    if (filters.tiers.size)   out = out.filter(m => filters.tiers.has(m.tier));
    if (!filters.showBlocked) out = out.filter(m => m.tier <= 3);
    if (filters.parameterised) out = out.filter(m => !!m.parameter);
    if (q.trim()) {
      const ql = q.toLowerCase();
      out = out.filter(m =>
        m.label.toLowerCase().includes(ql) ||
        (m.standFor || "").toLowerCase().includes(ql) ||
        (m.synonyms || []).some(s => s.toLowerCase().includes(ql)) ||
        (m.description || "").toLowerCase().includes(ql)
      );
    }
    return out;
  }, [q, filters]);

  const tierCounts = useMemoC(() => {
    const c = {};
    METRICS.forEach(m => { c[m.tier] = (c[m.tier] || 0) + 1; });
    return c;
  }, []);

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      <MetricsFilterRail filters={filters} setFilters={setFilters} tierCounts={tierCounts} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Search + sort row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <Input leftIcon="search" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search by metric name, synonym, or stand-for (e.g. 'whales', 'D7', 'paying users')"
            style={{ flex: 1, maxWidth: 560 }} size="md"
            rightSlot={q && <span onClick={() => setQ("")} style={{ cursor: "pointer", color: "var(--neutral-400)" }}><Icon name="x" size={14} /></span>}
          />
          <Button variant="ghost" size="sm" leftIcon="sparkles" onClick={openSearch}>Smart search</Button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "var(--neutral-500)", fontFamily: "var(--font-mono)" }}>{filtered.length} of {METRICS.length}</span>
          <ViewToggle view={view} setView={setView} />
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", background: "#fff", border: "1px dashed var(--border)", borderRadius: 12 }}>
            <Icon name="filter-x" size={20} color="var(--neutral-400)" />
            <div style={{ fontSize: 14, color: "var(--neutral-700)", marginTop: 8 }}>No metrics match these filters.</div>
            <Button variant="ghost" size="sm" leftIcon="rotate-ccw" onClick={() => setFilters({ domains: new Set(), trust: new Set(), owners: new Set(), tiers: new Set(), parameterised: false, showBlocked: false })} style={{ marginTop: 10 }}>Clear filters</Button>
          </div>
        )}

        {/* Grid / list */}
        {filtered.length > 0 && view === "grid" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
            {filtered.map(m => (
              <MetricCard key={m.id} metric={m} trustProminence={tweaks.trustProminence}
                onClick={() => go({ name: "metric", id: m.id })}
                onTokenClick={(c) => go({ name: c.type === "metric" ? "metric" : "data-model", id: c.id })}
              />
            ))}
          </div>
        )}
        {filtered.length > 0 && view === "list" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filtered.map(m => (
              <MetricCard key={m.id} metric={m} variant="list" trustProminence={tweaks.trustProminence}
                onClick={() => go({ name: "metric", id: m.id })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
//  DATA MODEL TAB  —  cube primitives. Sub-tabs: By concept · By cube · Schema
// ═══════════════════════════════════════════════════════════════════════════
const DataModelTab = ({ tweaks }) => {
  const { go } = useNav();
  const { setOpen: openSearch } = useGlobalSearch();
  const [tab, setTab] = useStateC("concept");
  const [view, setView] = useStateC("grid");
  const [q, setQ] = useStateC("");
  const [filters, setFilters] = useStateC({
    types: new Set(["measure", "dimension", "segment"]),
    domains: new Set(),
    trust: new Set(),
    owners: new Set(),
    cubes: new Set(),
  });

  const filtered = useMemoC(() => {
    let out = CONCEPTS.slice();
    out = out.filter(c => filters.types.has(c.type));
    if (filters.domains.size) out = out.filter(c => filters.domains.has(c.domain));
    if (filters.trust.size)   out = out.filter(c => filters.trust.has(c.trust));
    if (filters.owners.size)  out = out.filter(c => filters.owners.has(c.owner));
    if (filters.cubes.size)   out = out.filter(c => filters.cubes.has(c.cube));
    if (q.trim()) {
      const ql = q.toLowerCase();
      out = out.filter(c =>
        c.label.toLowerCase().includes(ql) ||
        (c.synonyms || []).some(s => s.toLowerCase().includes(ql)) ||
        (c.description || "").toLowerCase().includes(ql) ||
        `${c.cube}.${c.member}`.includes(ql)
      );
    }
    return out;
  }, [filters, q]);

  const counts = useMemoC(() => ({
    measure:   CONCEPTS.filter(c => c.type === "measure").length,
    dimension: CONCEPTS.filter(c => c.type === "dimension").length,
    segment:   CONCEPTS.filter(c => c.type === "segment").length,
  }), []);

  return (
    <div>
      {/* Sub-tab + search + view toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <Tabs value={tab} onChange={setTab}
          tabs={[
            { value: "concept", label: "By concept", icon: "sparkles", count: CONCEPTS.length },
            { value: "cube",    label: "By cube",    icon: "package",  count: Object.keys(CUBES).length },
            { value: "schema",  label: "Schema",     icon: "network" },
          ]} />
        <div style={{ flex: 1 }} />
        <ViewToggle view={view} setView={setView} />
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {tab === "concept" && <DataModelFilterRail filters={filters} setFilters={setFilters} counts={counts} />}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <Input leftIcon="search" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Filter measures · dimensions · segments by name or cube.member"
              style={{ flex: 1, maxWidth: 560 }} size="md"
              rightSlot={q && <span onClick={() => setQ("")} style={{ cursor: "pointer", color: "var(--neutral-400)" }}><Icon name="x" size={14} /></span>} />
            <Button variant="ghost" size="sm" leftIcon="sparkles" onClick={openSearch}>Smart search</Button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "var(--neutral-500)", fontFamily: "var(--font-mono)" }}>{filtered.length} of {CONCEPTS.length}</span>
          </div>

          {tab === "concept" && (
            view === "grid" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                {filtered.map(c => (
                  <ConceptCard key={c.id} concept={c} trustProminence={tweaks.trustProminence} onClick={() => go({ name: "data-model", id: c.id })} />
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filtered.map(c => (
                  <ConceptCard key={c.id} concept={c} variant="list" trustProminence={tweaks.trustProminence} onClick={() => go({ name: "data-model", id: c.id })} />
                ))}
              </div>
            )
          )}

          {tab === "cube"   && <ByCubeView filtered={filtered} />}
          {tab === "schema" && <SchemaView />}
        </div>
      </div>
    </div>
  );
};

// ───────────────── Filter rails ─────────────────
const MetricsFilterRail = ({ filters, setFilters, tierCounts }) => {
  const toggle = (key, value) => setFilters(f => {
    const next = new Set(f[key]); next.has(value) ? next.delete(value) : next.add(value);
    return { ...f, [key]: next };
  });
  return (
    <aside className="compass-filter-rail" style={{ width: "var(--filter-rail-w)", flexShrink: 0, position: "sticky", top: 20 }}>
      <Section title="Domain">
        {Object.keys(DOMAIN_INFO).filter(d => d !== "custom").map(d => (
          <CheckRow key={d} checked={filters.domains.has(d)} onChange={() => toggle("domains", d)} dot={DOMAIN_INFO[d].color} label={DOMAIN_INFO[d].label} />
        ))}
      </Section>

      <Section title="Tier" subtitle="Implementation status">
        {[1, 2, 3].map(t => {
          const info = TIER_INFO[t];
          return (
            <CheckRow key={t} checked={filters.tiers.has(t)} onChange={() => toggle("tiers", t)}
              tierGlyph={info.shortLabel} tierColor={info.color} tierBg={info.bg}
              label={info.description} count={tierCounts[t] || 0} />
          );
        })}
        <CheckRow checked={filters.showBlocked} onChange={() => setFilters(f => ({ ...f, showBlocked: !f.showBlocked }))}
          dot="var(--tier-6)" label="Show blocked tiers (T4–T6)" muted />
      </Section>

      <Section title="Status">
        {["certified", "beta", "draft"].map(t => (
          <CheckRow key={t} checked={filters.trust.has(t)} onChange={() => toggle("trust", t)}
            dot={t === "certified" ? "var(--trust-certified)" : t === "beta" ? "var(--trust-beta)" : "var(--trust-draft)"}
            label={t[0].toUpperCase() + t.slice(1)} />
        ))}
      </Section>

      <Section title="Family">
        <CheckRow checked={filters.parameterised} onChange={() => setFilters(f => ({ ...f, parameterised: !f.parameterised }))}
          icon="square-stack" iconColor="var(--neutral-700)" iconBg="var(--neutral-100)"
          label="Parameterised family · A(n), PU(n)…" />
      </Section>

      <Section title="Owner">
        {Object.values(OWNERS).slice(0, 5).map(o => (
          <CheckRow key={o.id} checked={filters.owners.has(o.id)} onChange={() => toggle("owners", o.id)} avatar={o.name} label={o.name} />
        ))}
      </Section>
    </aside>
  );
};

const DataModelFilterRail = ({ filters, setFilters, counts }) => {
  const toggle = (key, value) => setFilters(f => {
    const next = new Set(f[key]); next.has(value) ? next.delete(value) : next.add(value);
    return { ...f, [key]: next };
  });
  return (
    <aside className="compass-filter-rail" style={{ width: "var(--filter-rail-w)", flexShrink: 0, position: "sticky", top: 20 }}>
      <Section title="Type">
        {["measure", "dimension", "segment"].map(t => (
          <CheckRow key={t} checked={filters.types.has(t)} onChange={() => toggle("types", t)} icon={TYPE_INFO[t].icon} iconBg={TYPE_INFO[t].bg} iconColor={TYPE_INFO[t].color} label={TYPE_INFO[t].label + "s"} count={counts[t]} />
        ))}
      </Section>

      <Section title="Cube" subtitle="The 4 published cubes">
        {Object.entries(CUBES).map(([key, info]) => (
          <CheckRow key={key} checked={filters.cubes.has(key)} onChange={() => toggle("cubes", key)}
            icon={info.icon} iconColor="var(--neutral-700)" iconBg="var(--neutral-100)"
            label={info.label} />
        ))}
      </Section>

      <Section title="Domain">
        {Object.keys(DOMAIN_INFO).filter(d => d !== "custom").map(d => (
          <CheckRow key={d} checked={filters.domains.has(d)} onChange={() => toggle("domains", d)} dot={DOMAIN_INFO[d].color} label={DOMAIN_INFO[d].label} />
        ))}
      </Section>

      <Section title="Status">
        {["certified", "beta", "draft"].map(t => (
          <CheckRow key={t} checked={filters.trust.has(t)} onChange={() => toggle("trust", t)}
            dot={t === "certified" ? "var(--trust-certified)" : t === "beta" ? "var(--trust-beta)" : "var(--trust-draft)"}
            label={t[0].toUpperCase() + t.slice(1)} />
        ))}
      </Section>

      <Section title="Owner">
        {Object.values(OWNERS).slice(0, 5).map(o => (
          <CheckRow key={o.id} checked={filters.owners.has(o.id)} onChange={() => toggle("owners", o.id)} avatar={o.name} label={o.name} />
        ))}
      </Section>
    </aside>
  );
};

const Section = ({ title, subtitle, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ padding: "0 6px", marginBottom: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11, color: "var(--neutral-400)", marginTop: 1 }}>{subtitle}</div>}
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
  </div>
);

const CheckRow = ({ checked, onChange, icon, iconBg, iconColor, dot, avatar, label, count, muted, tierGlyph, tierColor, tierBg }) => (
  <label style={{
    display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", borderRadius: 6, cursor: "pointer",
    fontFamily: "var(--font-sans)", fontSize: 13, color: muted ? "var(--neutral-500)" : "var(--neutral-800)",
  }} onMouseEnter={e => e.currentTarget.style.background = "var(--neutral-100)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
    <span style={{
      width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${checked ? "var(--neutral-900)" : "var(--neutral-300)"}`,
      background: checked ? "var(--neutral-900)" : "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      {checked && <Icon name="check" size={10} color="#fff" />}
    </span>
    {tierGlyph && (
      <span style={{
        width: 22, height: 18, borderRadius: 4, background: tierBg, color: tierColor,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
      }}>{tierGlyph}</span>
    )}
    {icon && <span style={{ width: 18, height: 18, borderRadius: 4, background: iconBg, color: iconColor, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={11} /></span>}
    {dot && <span style={{ width: 8, height: 8, borderRadius: 99, background: dot, flexShrink: 0 }} />}
    {avatar && <Avatar name={avatar} size={16} />}
    <span style={{ flex: 1 }}>{label}</span>
    {count != null && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--neutral-400)" }}>{count}</span>}
    <input type="checkbox" checked={checked} onChange={onChange} style={{ display: "none" }} />
  </label>
);

const ViewToggle = ({ view, setView }) => (
  <div style={{ display: "flex", gap: 2, padding: 2, background: "var(--neutral-100)", borderRadius: 8 }}>
    <span onClick={() => setView("grid")} title="Grid view" style={{ padding: "5px 8px", borderRadius: 6, background: view === "grid" ? "#fff" : "transparent", cursor: "pointer", boxShadow: view === "grid" ? "var(--shadow-xs)" : "none" }}>
      <Icon name="layout-grid" size={14} color="var(--neutral-700)" />
    </span>
    <span onClick={() => setView("list")} title="List view" style={{ padding: "5px 8px", borderRadius: 6, background: view === "list" ? "#fff" : "transparent", cursor: "pointer", boxShadow: view === "list" ? "var(--shadow-xs)" : "none" }}>
      <Icon name="list" size={14} color="var(--neutral-700)" />
    </span>
  </div>
);

const ImportBanner = () => (
  <div style={{
    display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
    background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, marginBottom: 18,
  }}>
    <span style={{ width: 28, height: 28, borderRadius: 999, background: "rgba(245,158,11,0.18)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#b45309" }}>
      <Icon name="download" size={14} />
    </span>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>Metric registry seeded from GDS-1.8 · 21 of 53 metrics imported (Tier 1–3)</div>
      <div style={{ fontSize: 12, color: "#b45309", marginTop: 2 }}>Tier 4–6 metrics need query templates, new YAML, or upstream data sources — flagged honestly on each card. You can author on top of any imported metric.</div>
    </div>
    <Button variant="ghost" size="sm">Coverage report</Button>
  </div>
);

// ─── "By cube" view ──────────────────────────────
const ByCubeView = ({ filtered }) => {
  const { go } = useNav();
  const grouped = {};
  filtered.forEach(c => { (grouped[c.cube] = grouped[c.cube] || []).push(c); });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {Object.keys(CUBES).filter(k => grouped[k]).map(cubeKey => {
        const info = CUBES[cubeKey];
        const items = grouped[cubeKey];
        return (
          <div key={cubeKey}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--neutral-950)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                <Icon name={info.icon} size={15} />
              </span>
              <div>
                <div style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 14, color: "var(--neutral-950)" }}>{info.label}</div>
                <div style={{ fontSize: 11, color: "var(--neutral-500)", fontFamily: "var(--font-mono)" }}>cube · {info.grain} · {items.length} members</div>
              </div>
              <div style={{ flex: 1 }} />
              <Button variant="ghost" size="sm" leftIcon="file-text">View YAML</Button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {items.map(c => (
                <ConceptCard key={c.id} concept={c} onClick={() => go({ name: "data-model", id: c.id })} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const SchemaView = () => (
  <div style={{ padding: 28, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, minHeight: 360, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
    <Icon name="network" size={28} color="var(--neutral-400)" />
    <div style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 14, color: "var(--neutral-700)" }}>Schema view — existing</div>
    <div style={{ fontSize: 12, color: "var(--neutral-500)", textAlign: "center", maxWidth: 360 }}>The cube YAML schema browser stays as-is. Compass extends it but does not replace it.</div>
  </div>
);

Object.assign(window, { CatalogPage });
