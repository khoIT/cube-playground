/* global React, Icon, Button, Badge, Avatar, Input, Tooltip, Popover, Kbd, ConceptCard, CONCEPTS, NOTIFICATIONS, TypeIcon */
/* Compass app shell — sidebar nav, top bar, global NL search overlay, notifications panel.
   The router is in-memory: a NavContext with current route + setRoute. Routes are objects
   so we can pass params (e.g. metric id) without doing URL parsing here. */

const { useState: useStateA, useEffect: useEffectA, useRef: useRefA, useMemo: useMemoA, createContext: createContextA, useContext: useContextA, useCallback: useCallbackA } = React;

// ─── Routing context ───────────────────────────────────────────────
const NavContext = createContextA(null);
const useNav = () => useContextA(NavContext);

const NavProvider = ({ children, initial = { name: "catalog" } }) => {
  const [route, setRoute] = useStateA(initial);
  const [history, setHistory] = useStateA([initial]);
  const go = useCallbackA((next) => {
    setRoute(next);
    setHistory((h) => [...h.slice(-9), next]);
  }, []);
  const back = useCallbackA(() => {
    setHistory((h) => {
      if (h.length < 2) return h;
      const next = h.slice(0, -1);
      setRoute(next[next.length - 1]);
      return next;
    });
  }, []);
  return <NavContext.Provider value={{ route, go, back, history }}>{children}</NavContext.Provider>;
};

// ─── Sidebar nav ───────────────────────────────────────────────────
const NAV = [
  { key: "catalog",  label: "Catalog",     icon: "library-big",   route: { name: "catalog" } },
  { key: "explore",  label: "Explore",     icon: "compass",       route: { name: "explore" } },
  { key: "views",    label: "Saved Views", icon: "bookmark",      route: { name: "views" } },
  { key: "workspaces", label: "Workspaces",icon: "layout-grid",   route: { name: "workspaces" } },
  { key: "digest",   label: "Digest",      icon: "mail",          route: { name: "digest" } },
  { key: "notifications", label: "Notifications", icon: "bell",   route: { name: "notifications" }, badge: 2 },
];
const NAV_AUTHOR = [
  { key: "new",      label: "New metric…",  icon: "plus",   route: { name: "wizard" }, accent: true },
];

const CompassMark = ({ size = 28 }) => (
  // Simple inline mark — concentric arcs evoking a compass rose
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: "block" }}>
    <rect width="32" height="32" rx="8" fill="var(--neutral-950)" />
    <circle cx="16" cy="16" r="9" stroke="#fff" strokeWidth="1.3" opacity="0.4" />
    <path d="M16 6 L19 16 L16 26 L13 16 Z" fill="var(--orange-600)" />
    <path d="M6 16 L16 13 L26 16 L16 19 Z" fill="#fff" opacity="0.9" />
    <circle cx="16" cy="16" r="1.6" fill="var(--neutral-950)" />
  </svg>
);

const Sidebar = ({ collapsed, onToggle }) => {
  const { route, go } = useNav();
  return (
    <aside style={{
      width: collapsed ? 56 : 220, background: "var(--rail-bg)", borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column", flexShrink: 0, transition: "width .2s",
    }}>
      <div style={{ padding: collapsed ? "14px 0" : "14px 16px", display: "flex", alignItems: "center", gap: 10, height: "var(--topbar-h)", boxSizing: "border-box", justifyContent: collapsed ? "center" : "flex-start" }}>
        <CompassMark size={28} />
        {!collapsed && <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
          <span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 15, color: "var(--neutral-950)", letterSpacing: "-0.01em" }}>Compass</span>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 10, color: "var(--neutral-500)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>VNGGames · Data</span>
        </div>}
      </div>

      <nav style={{ flex: 1, padding: 6, display: "flex", flexDirection: "column", gap: 1, overflowY: "auto" }}>
        {NAV.map(item => {
          const isActive = route.name === item.route.name;
          return (
            <NavItem key={item.key} item={item} active={isActive} collapsed={collapsed} onClick={() => go(item.route)} />
          );
        })}
        {!collapsed && <div style={{ padding: "12px 10px 4px", fontSize: 10, fontWeight: 600, color: "var(--neutral-500)", letterSpacing: "0.07em", textTransform: "uppercase" }}>Author</div>}
        {NAV_AUTHOR.map(item => (
          <NavItem key={item.key} item={item} active={false} collapsed={collapsed} onClick={() => go(item.route)} />
        ))}
      </nav>

      <div style={{ padding: 10, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar name="Khoi Tran" size={collapsed ? 28 : 30} />
        {!collapsed && (
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--neutral-950)" }}>Khoi Tran</span>
            <span style={{ fontSize: 11, color: "var(--neutral-500)" }}>Liveops · Ballistar VN</span>
          </div>
        )}
        {!collapsed && <Icon name="chevrons-up-down" size={14} color="var(--neutral-400)" />}
      </div>
    </aside>
  );
};

const NavItem = ({ item, active, collapsed, onClick }) => (
  <div onClick={onClick} title={collapsed ? item.label : undefined} style={{
    display: "flex", alignItems: "center", gap: 10,
    padding: collapsed ? "8px 0" : "7px 10px",
    borderRadius: 8, cursor: "pointer",
    background: active ? "var(--neutral-100)" : "transparent",
    color: active ? "var(--neutral-950)" : (item.accent ? "var(--primary)" : "var(--neutral-700)"),
    fontFamily: "var(--font-sans)", fontWeight: active ? 500 : 400, fontSize: 13,
    justifyContent: collapsed ? "center" : "flex-start", position: "relative",
    transition: "background .15s, color .15s",
  }} onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--neutral-50)"; }} onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
    <Icon name={item.icon} size={15} />
    {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
    {!collapsed && item.badge && <Badge variant="brand" style={{ padding: "1px 6px", fontSize: 10 }}>{item.badge}</Badge>}
  </div>
);

// ─── Top bar with global NL search ─────────────────────────────────
const TopBar = ({ onToggleSidebar, breadcrumbs, actions }) => {
  const { go } = useNav();
  return (
    <header style={{
      height: "var(--topbar-h)", background: "#fff", borderBottom: "1px solid var(--border)",
      display: "flex", alignItems: "center", padding: "0 18px", gap: 12, flexShrink: 0, position: "sticky", top: 0, zIndex: 10,
    }}>
      <Button variant="ghost" size="iconSm" onClick={onToggleSidebar} title="Toggle sidebar"><Icon name="panel-left" size={15} /></Button>
      {breadcrumbs && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--neutral-600)", fontFamily: "var(--font-sans)", overflow: "hidden" }}>
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Icon name="chevron-right" size={12} color="var(--neutral-400)" />}
              <span onClick={b.onClick} style={{ cursor: b.onClick ? "pointer" : "default", color: i === breadcrumbs.length - 1 ? "var(--neutral-950)" : "var(--neutral-600)", fontWeight: i === breadcrumbs.length - 1 ? 500 : 400, whiteSpace: "nowrap" }}>{b.label}</span>
            </React.Fragment>
          ))}
        </div>
      )}

      <div style={{ flex: 1 }} />

      <GlobalSearchButton />

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {actions}
        <Tooltip content="Notifications">
          <Button variant="ghost" size="iconSm" onClick={() => go({ name: "notifications" })}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              <Icon name="bell" size={15} />
              <span style={{ position: "absolute", top: -2, right: -2, width: 6, height: 6, borderRadius: 99, background: "var(--primary)" }} />
            </span>
          </Button>
        </Tooltip>
        <Tooltip content="Help"><Button variant="ghost" size="iconSm"><Icon name="help-circle" size={15} /></Button></Tooltip>
      </div>
    </header>
  );
};

// ─── Global NL search (overlay, opened via header button or ⌘K) ────
const GlobalSearchContext = createContextA(null);
const useGlobalSearch = () => useContextA(GlobalSearchContext);

const GlobalSearchProvider = ({ children }) => {
  const [open, setOpen] = useStateA(false);
  useEffectA(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setOpen(true); }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <GlobalSearchContext.Provider value={{ open, setOpen }}>
      {children}
      <GlobalSearchOverlay open={open} onClose={() => setOpen(false)} />
    </GlobalSearchContext.Provider>
  );
};

const GlobalSearchButton = () => {
  const { setOpen } = useGlobalSearch();
  return (
    <div onClick={() => setOpen(true)} style={{
      display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 10px 0 10px",
      border: "1px solid var(--border)", borderRadius: 8, background: "var(--neutral-50)",
      cursor: "pointer", width: 360, transition: "border-color .15s",
    }} onMouseEnter={e => e.currentTarget.style.borderColor = "var(--neutral-300)"} onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}>
      <Icon name="search" size={14} color="var(--neutral-500)" />
      <span style={{ flex: 1, fontSize: 13, color: "var(--neutral-500)", fontFamily: "var(--font-sans)" }}>Search the catalog…</span>
      <Kbd>⌘K</Kbd>
    </div>
  );
};

// Substring + synonym-aware search across label, description, synonyms.
const searchConcepts = (q) => {
  if (!q.trim()) return [];
  const ql = q.toLowerCase();
  const scored = CONCEPTS.map(c => {
    let score = 0;
    if (c.label.toLowerCase().includes(ql)) score += 10;
    if (c.label.toLowerCase().startsWith(ql)) score += 8;
    if ((c.synonyms || []).some(s => s.toLowerCase().includes(ql))) score += 7;
    if ((c.description || "").toLowerCase().includes(ql)) score += 3;
    if (`${c.cube}.${c.member}`.includes(ql)) score += 5;
    if ((c.sampleQuestions || []).some(s => s.toLowerCase().includes(ql))) score += 2;
    return { c, score };
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score);
  return scored.slice(0, 6).map(x => x.c);
};

const GlobalSearchOverlay = ({ open, onClose }) => {
  const { go } = useNav();
  const [q, setQ] = useStateA("");
  const [framing, setFraming] = useStateA("smart"); // smart | strict (Tweak)
  useEffectA(() => { if (!open) setQ(""); }, [open]);
  const results = useMemoA(() => searchConcepts(q), [q]);
  const suggestions = ["whales in VN", "revenue last 7 days", "first day retention", "lapsed payer", "arppu by tier"];

  if (!open) return null;
  const isQuestion = q.includes("?") || /^(what|how|why|when|tell)/i.test(q);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1100, background: "rgba(10,10,10,0.5)",
      display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 100,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 640, maxWidth: "calc(100vw - 32px)", background: "#fff", borderRadius: 12,
        boxShadow: "var(--shadow-2xl)", border: "1px solid var(--border)", overflow: "hidden",
      }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="search" size={16} color="var(--neutral-500)" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder={framing === "smart" ? "Search the catalog (e.g. 'whales in VN', 'revenue', 'D7 retention')" : "Type a metric name…"}
            style={{ flex: 1, border: 0, outline: 0, fontSize: 15, fontFamily: "var(--font-sans)", color: "var(--neutral-950)" }} />
          <Kbd>esc</Kbd>
        </div>

        {/* Framing hint — addresses PRD open question §10.1 */}
        <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--neutral-100)", display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--neutral-500)", background: "var(--neutral-50)" }}>
          <Icon name="info" size={12} />
          <span><b style={{ color: "var(--neutral-700)" }}>Catalog search</b> — finds concepts by name, synonym, or sample question. Does not generate SQL.</span>
        </div>

        <div style={{ maxHeight: 460, overflowY: "auto", padding: 8 }}>
          {!q && (
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Try searching for</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {suggestions.map(s => (
                  <span key={s} onClick={() => setQ(s)} style={{
                    display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px",
                    border: "1px solid var(--border)", borderRadius: 9999, fontSize: 12, color: "var(--neutral-700)",
                    cursor: "pointer", background: "#fff",
                  }}><Icon name="sparkles" size={11} color="var(--neutral-400)" /> {s}</span>
                ))}
              </div>
              <div style={{ marginTop: 16, fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Recent</div>
              {CONCEPTS.slice(0, 3).map(c => (
                <ConceptCard key={c.id} concept={c} variant="search" onClick={() => { go({ name: "metric", id: c.id }); onClose(); }} />
              ))}
            </div>
          )}
          {q && results.length === 0 && (
            <div style={{ padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "var(--neutral-600)", marginBottom: 6 }}>No concepts matched <b style={{ color: "var(--neutral-900)" }}>"{q}"</b></div>
              <div style={{ fontSize: 12, color: "var(--neutral-500)", marginBottom: 12 }}>{isQuestion ? "Tip: Compass searches the catalog vocabulary. Try a metric name or business word." : "Try a synonym or browse the catalog."}</div>
              <Button variant="outline" size="sm" leftIcon="library-big" onClick={() => { go({ name: "catalog" }); onClose(); }}>Browse catalog</Button>
            </div>
          )}
          {q && results.length > 0 && (
            <div>
              <div style={{ padding: "6px 12px 4px", fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{results.length} matches</div>
              {results.map(c => (
                <ConceptCard key={c.id} concept={c} variant="search" onClick={() => { go({ name: "metric", id: c.id }); onClose(); }} />
              ))}
              {/* P4 reserved space: agent response slot */}
              <div style={{ margin: "8px 12px 4px", padding: "10px 12px", border: "1px dashed var(--border)", borderRadius: 8, fontSize: 12, color: "var(--neutral-500)", display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="sparkles" size={13} color="var(--neutral-400)" />
                <span><b style={{ color: "var(--neutral-700)" }}>Coming in v4:</b> ask follow-up questions — Compass will compose an answer from these concepts.</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "var(--neutral-500)", background: "var(--neutral-50)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Kbd>↵</Kbd> Open detail</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Kbd>⌘↵</Kbd> Open in Explore</span>
          <span style={{ flex: 1 }} />
          <span>Compass v0.3 · GDS-1.8</span>
        </div>
      </div>
    </div>
  );
};

// ─── App layout — sidebar + content area ───────────────────────────
const AppShell = ({ children, breadcrumbs, actions, sidebarCollapsed, setSidebarCollapsed }) => {
  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", background: "var(--app-bg)", overflow: "hidden" }}>
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar onToggleSidebar={() => setSidebarCollapsed(v => !v)} breadcrumbs={breadcrumbs} actions={actions} />
        <main style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>{children}</main>
      </div>
    </div>
  );
};

Object.assign(window, { NavContext, NavProvider, useNav, GlobalSearchProvider, useGlobalSearch, AppShell, CompassMark, GlobalSearchOverlay });
