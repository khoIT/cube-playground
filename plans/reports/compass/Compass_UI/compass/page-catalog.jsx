/* global React, Icon, Button, Badge, Input, Tabs, Tooltip, Popover, ConceptCard, Avatar, OWNERS, CONCEPTS, TypeIcon, DomainChip, DOMAIN_INFO, TYPE_INFO, useNav, Switch, useGlobalSearch */
/* Compass — Catalog page. Concept-first grid + filter rail + tab switcher.
   Surfaces specified in PRD §5.1 (Extended Catalog) and §5.5 (Certified badge crossover). */

const { useState: useStateC, useMemo: useMemoC } = React;

const CatalogPage = ({ tweaks }) => {
  const { go } = useNav();
  const { setOpen: openSearch } = useGlobalSearch();
  const [tab, setTab] = useStateC("concept");
  const [view, setView] = useStateC("grid"); // grid | list
  const [q, setQ] = useStateC("");
  const [filters, setFilters] = useStateC({
    types: new Set(["measure", "dimension", "segment"]),
    domains: new Set(),
    trust: new Set(),  // empty = all
    owners: new Set(),
    showDeprecated: false,
  });

  const filtered = useMemoC(() => {
    let out = CONCEPTS.slice();
    out = out.filter(c => filters.types.has(c.type));
    if (filters.domains.size) out = out.filter(c => filters.domains.has(c.domain));
    if (filters.trust.size) out = out.filter(c => filters.trust.has(c.trust));
    else if (!filters.showDeprecated) out = out.filter(c => c.trust !== "deprecated" && c.trust !== "orphaned");
    if (filters.owners.size) out = out.filter(c => filters.owners.has(c.owner));
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
    measure: CONCEPTS.filter(c => c.type === "measure").length,
    dimension: CONCEPTS.filter(c => c.type === "dimension").length,
    segment: CONCEPTS.filter(c => c.type === "segment").length,
  }), []);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1480, margin: "0 auto" }}>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 18, gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 22, color: "var(--neutral-950)", margin: 0, letterSpacing: "-0.02em" }}>Catalog</h1>
          <div style={{ fontSize: 13, color: "var(--neutral-600)", marginTop: 4, maxWidth: 720 }}>
            Every concept you can use in a query: measures, dimensions, and segments — owned, certified, and ready.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button variant="outline" size="sm" leftIcon="git-fork" onClick={() => {}}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              GDS-1.8 <Badge variant="info" style={{ fontSize: 10 }}>v1.8.2</Badge>
            </span>
          </Button>
          <Button variant="primary" size="sm" leftIcon="plus" onClick={() => go({ name: "wizard" })}>New concept</Button>
        </div>
      </div>

      {/* Import-in-progress banner — a state from PRD §5.1 */}
      <ImportBanner />

      {/* Tab switcher + view toggle + concept-type filter chips */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <Tabs
          value={tab} onChange={setTab}
          tabs={[
            { value: "concept", label: "By concept", icon: "sparkles", count: CONCEPTS.length },
            { value: "cube",    label: "By cube",    icon: "package",  count: 4 },
            { value: "schema",  label: "Schema",     icon: "network",  count: null },
          ]}
        />
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 2, padding: 2, background: "var(--neutral-100)", borderRadius: 8 }}>
          <span onClick={() => setView("grid")} title="Grid view" style={{ padding: "5px 8px", borderRadius: 6, background: view === "grid" ? "#fff" : "transparent", cursor: "pointer", boxShadow: view === "grid" ? "var(--shadow-xs)" : "none" }}>
            <Icon name="layout-grid" size={14} color="var(--neutral-700)" />
          </span>
          <span onClick={() => setView("list")} title="List view" style={{ padding: "5px 8px", borderRadius: 6, background: view === "list" ? "#fff" : "transparent", cursor: "pointer", boxShadow: view === "list" ? "var(--shadow-xs)" : "none" }}>
            <Icon name="list" size={14} color="var(--neutral-700)" />
          </span>
        </div>
      </div>

      {/* Two-column layout: filter rail + grid */}
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {tab === "concept" && (
          <FilterRail filters={filters} setFilters={setFilters} counts={counts} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Search row */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <Input leftIcon="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by name, synonym, or description"
              style={{ flex: 1, maxWidth: 560 }} size="md"
              rightSlot={q && <span onClick={() => setQ("")} style={{ cursor: "pointer", color: "var(--neutral-400)" }}><Icon name="x" size={14} /></span>}
            />
            <Button variant="ghost" size="sm" leftIcon="sparkles" onClick={openSearch}>Smart search</Button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "var(--neutral-500)", fontFamily: "var(--font-mono)" }}>{filtered.length} of {CONCEPTS.length}</span>
            <Popover trigger={<Button variant="outline" size="sm" leftIcon="arrow-down-up">Sort</Button>} width={200}>
              {["Most used", "Recently edited", "A → Z", "Freshness"].map(o => (
                <div key={o} style={{ padding: "8px 10px", fontSize: 13, borderRadius: 6, cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = "var(--neutral-50)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{o}</div>
              ))}
            </Popover>
          </div>

          {/* Body — switch by tab */}
          {tab === "concept" && (
            view === "grid" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                {filtered.map(c => (
                  <ConceptCard key={c.id} concept={c} trustProminence={tweaks.trustProminence} onClick={() => go({ name: "metric", id: c.id })} />
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filtered.map(c => (
                  <ConceptCard key={c.id} concept={c} variant="list" trustProminence={tweaks.trustProminence} onClick={() => go({ name: "metric", id: c.id })} />
                ))}
              </div>
            )
          )}

          {tab === "cube" && <ByCubeView filtered={filtered} />}
          {tab === "schema" && <SchemaView />}
        </div>
      </div>
    </div>
  );
};

const ImportBanner = () => (
  <div style={{
    display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
    background: "linear-gradient(0deg, #fffbeb, #fffbeb)", border: "1px solid #fde68a", borderRadius: 10, marginBottom: 18,
  }}>
    <span style={{ width: 28, height: 28, borderRadius: 999, background: "rgba(245,158,11,0.18)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#b45309" }}>
      <Icon name="download" size={14} />
    </span>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>GDS-1.8 glossary import in progress — 31 of 53 concepts seeded</div>
      <div style={{ fontSize: 12, color: "#b45309", marginTop: 2 }}>You can already author on top of any imported concept. Synonyms and sample questions are not yet auto-populated.</div>
    </div>
    <div style={{ width: 180, height: 6, borderRadius: 4, background: "rgba(245,158,11,0.2)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: "58%", background: "var(--amber-500)" }} />
    </div>
    <Button variant="ghost" size="sm">Dismiss</Button>
  </div>
);

const FilterRail = ({ filters, setFilters, counts }) => {
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

      <Section title="Domain">
        {Object.keys(DOMAIN_INFO).filter(d => d !== "custom").map(d => (
          <CheckRow key={d} checked={filters.domains.has(d)} onChange={() => toggle("domains", d)} dot={DOMAIN_INFO[d].color} label={DOMAIN_INFO[d].label} />
        ))}
      </Section>

      <Section title="Status">
        {["certified", "beta", "draft"].map(t => (
          <CheckRow key={t} checked={filters.trust.has(t)} onChange={() => toggle("trust", t)} dot={t === "certified" ? "var(--trust-certified)" : t === "beta" ? "var(--trust-beta)" : "var(--trust-draft)"} label={t[0].toUpperCase() + t.slice(1)} />
        ))}
        <CheckRow checked={filters.showDeprecated} onChange={() => setFilters(f => ({...f, showDeprecated: !f.showDeprecated}))} dot="var(--trust-deprecated)" label="Show deprecated & orphaned" muted />
      </Section>

      <Section title="Owner">
        {Object.values(OWNERS).slice(0, 5).map(o => (
          <CheckRow key={o.id} checked={filters.owners.has(o.id)} onChange={() => toggle("owners", o.id)} avatar={o.name} label={o.name} />
        ))}
      </Section>
    </aside>
  );
};

const Section = ({ title, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, padding: "0 6px" }}>{title}</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
  </div>
);

const CheckRow = ({ checked, onChange, icon, iconBg, iconColor, dot, avatar, label, count, muted }) => (
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
    {icon && <span style={{ width: 18, height: 18, borderRadius: 4, background: iconBg, color: iconColor, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={11} /></span>}
    {dot && <span style={{ width: 8, height: 8, borderRadius: 99, background: dot, flexShrink: 0 }} />}
    {avatar && <Avatar name={avatar} size={16} />}
    <span style={{ flex: 1 }}>{label}</span>
    {count != null && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--neutral-400)" }}>{count}</span>}
    <input type="checkbox" checked={checked} onChange={onChange} style={{ display: "none" }} />
  </label>
);

// ─── "By cube" tab ────────────────────────────────────────────────
const ByCubeView = ({ filtered }) => {
  const cubes = {};
  filtered.forEach(c => { (cubes[c.cube] = cubes[c.cube] || []).push(c); });
  const { go } = useNav();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {Object.entries(cubes).map(([cube, items]) => (
        <div key={cube}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--neutral-900)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
              <Icon name="package" size={14} />
            </span>
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 14, color: "var(--neutral-950)" }}>{cube}</div>
              <div style={{ fontSize: 11, color: "var(--neutral-500)", fontFamily: "var(--font-mono)" }}>cube · {items.length} members</div>
            </div>
            <div style={{ flex: 1 }} />
            <Button variant="ghost" size="sm" leftIcon="file-text">View YAML</Button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {items.map(c => (
              <ConceptCard key={c.id} concept={c} onClick={() => go({ name: "metric", id: c.id })} />
            ))}
          </div>
        </div>
      ))}
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
