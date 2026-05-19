/* global React, Icon, Button, Badge, Input, Tooltip, Popover, Card, Sparkline, Avatar, Switch,
   ConceptCard, TrustBadge, Freshness, AnomalyBadge, TypeIcon, TypeChip, DomainChip,
   CONCEPTS, METRICS, CONCEPT_BY_ID, CATALOG_BY_ID, OWNERS, useNav, useToast, Modal, Divider, FeedbackWidget */
/* Compass — Explore page (the existing QueryBuilder, extended with verb chips & save-view).
   The Explore canvas itself is a faithful mock — measure picker, dimensions, segments, filters,
   time picker, results panel with chip composition. PRD §5.7. */

const { useState: useStateE, useMemo: useMemoE } = React;

const ExplorePage = ({ initialMeasureId, initialDimensionId, tweaks, openSaveView, openChangeAnalysis }) => {
  const { go } = useNav();
  const toast = useToast();

  const [measureIds, setMeasureIds] = useStateE(() => [initialMeasureId || "m.revenue"]);
  const [dimensionIds, setDimensionIds] = useStateE(() => initialDimensionId ? [initialDimensionId] : []);
  const [segmentIds, setSegmentIds] = useStateE(() => []);
  const [filters, setFilters] = useStateE([]); // [{ dim, op, value }]
  const [granularity, setGranularity] = useStateE("day");
  const [period, setPeriod] = useStateE("Last 7 days");
  const [comparison, setComparison] = useStateE(null); // null | "vs last 7d" | "vs last 30d" | "YoY"
  const [chart, setChart] = useStateE("table"); // table | line | bar | number
  const [sqlOpen, setSqlOpen] = useStateE(false);

  const measures = measureIds.map(id => CATALOG_BY_ID[id]).filter(Boolean);
  const dimensions = dimensionIds.map(id => CATALOG_BY_ID[id]).filter(Boolean);
  const segments = segmentIds.map(id => CATALOG_BY_ID[id]).filter(Boolean);

  // Pseudo-result rows
  const rows = useMemoE(() => generateRows(measures, dimensions, segments, period), [measureIds, dimensionIds, segmentIds, period]);
  const totalRow = useMemoE(() => generateTotal(measures), [measureIds]);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left rail — concept picker */}
      <LeftRail
        measureIds={measureIds} setMeasureIds={setMeasureIds}
        dimensionIds={dimensionIds} setDimensionIds={setDimensionIds}
        segmentIds={segmentIds} setSegmentIds={setSegmentIds}
      />

      {/* Center — query + results */}
      <div style={{ flex: 1, overflowY: "auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Query header strip */}
        <div style={{ borderBottom: "1px solid var(--border)", background: "#fff", padding: "12px 20px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Tooltip content="Untitled query"><Icon name="compass" size={16} color="var(--neutral-500)" /></Tooltip>
          <span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 15, color: "var(--neutral-950)" }}>Untitled exploration</span>
          <Badge variant="secondary" leftIcon="circle-dot" style={{ fontSize: 10 }}>Unsaved</Badge>
          <div style={{ flex: 1 }} />
          <Tooltip content="Show generated SQL"><Button variant="ghost" size="sm" leftIcon="code-2" onClick={() => setSqlOpen(true)}>SQL</Button></Tooltip>
          <Button variant="outline" size="sm" leftIcon="share-2">Share</Button>
          <Button variant="primary" size="sm" leftIcon="bookmark" onClick={openSaveView}>Save view</Button>
        </div>

        {/* Pills row — current query */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "#fff", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <SelectionPill icon="sigma" colorVar="var(--type-measure)" bgVar="var(--type-measure-bg)" label="Measure">
            {measures.map(m => <ChipItem key={m.id} label={m.label} onRemove={() => setMeasureIds(ids => ids.filter(x => x !== m.id))} />)}
            <AddBtn onClick={() => {}} label="add measure" />
          </SelectionPill>
          <SelectionPill icon="rows-3" colorVar="var(--type-dim)" bgVar="var(--type-dim-bg)" label="By">
            {dimensions.length ? dimensions.map(d => <ChipItem key={d.id} label={d.label} onRemove={() => setDimensionIds(ids => ids.filter(x => x !== d.id))} />) :
              <span style={{ fontSize: 12, color: "var(--neutral-500)", padding: "1px 6px" }}>none</span>}
            <AddBtn onClick={() => {}} label="group by" />
          </SelectionPill>
          <SelectionPill icon="filter" colorVar="var(--type-segment)" bgVar="var(--type-segment-bg)" label="Where">
            {segments.length ? segments.map(s => <ChipItem key={s.id} label={s.label} onRemove={() => setSegmentIds(ids => ids.filter(x => x !== s.id))} />) :
              <span style={{ fontSize: 12, color: "var(--neutral-500)", padding: "1px 6px" }}>all users</span>}
            <AddBtn onClick={() => {}} label="filter" />
          </SelectionPill>
          <SelectionPill icon="calendar" colorVar="var(--neutral-800)" bgVar="var(--neutral-100)" label="Range">
            <ChipItem label={period} />
            <Popover trigger={<AddBtn label="change" />} width={220}>
              {["Last 24 hours", "Last 7 days", "Last 14 days", "Last 30 days", "Last 90 days", "This month", "Last month", "YTD"].map(p => (
                <div key={p} onClick={() => setPeriod(p)} style={{ padding: "8px 10px", fontSize: 13, borderRadius: 6, cursor: "pointer", color: period === p ? "var(--primary)" : "var(--neutral-800)" }} onMouseEnter={e => e.currentTarget.style.background = "var(--neutral-50)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{p}</div>
              ))}
            </Popover>
          </SelectionPill>
          {comparison && (
            <SelectionPill icon="git-compare" colorVar="var(--neutral-800)" bgVar="var(--neutral-100)" label="Compare">
              <ChipItem label={comparison} onRemove={() => setComparison(null)} />
            </SelectionPill>
          )}
        </div>

        {/* Result viz toolbar */}
        <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 8, background: "var(--neutral-50)", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 4, padding: 2, background: "#fff", border: "1px solid var(--border)", borderRadius: 8 }}>
            {[
              { v: "table",  icon: "table" },
              { v: "line",   icon: "line-chart" },
              { v: "bar",    icon: "bar-chart-3" },
              { v: "number", icon: "hash" },
            ].map(c => (
              <span key={c.v} onClick={() => setChart(c.v)} title={c.v} style={{
                padding: "5px 9px", borderRadius: 6, cursor: "pointer",
                background: chart === c.v ? "var(--neutral-100)" : "transparent",
                color: chart === c.v ? "var(--neutral-950)" : "var(--neutral-500)",
              }}><Icon name={c.icon} size={14} /></span>
            ))}
          </div>
          {dimensions.some(d => d.id === "bb.active_daily.log_date" || d.id === "bb.user_recharge_daily.log_date" || d.id === "bb.recharge.recharge_date") && (
            <div style={{ display: "flex", gap: 2, padding: 2, background: "#fff", border: "1px solid var(--border)", borderRadius: 8 }}>
              {["day", "week", "month"].map(g => (
                <span key={g} onClick={() => setGranularity(g)} style={{ padding: "4px 8px", borderRadius: 6, fontSize: 12, fontFamily: "var(--font-sans)", fontWeight: 500, cursor: "pointer", background: granularity === g ? "var(--neutral-100)" : "transparent", color: granularity === g ? "var(--neutral-950)" : "var(--neutral-600)" }}>{g}</span>
              ))}
            </div>
          )}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "var(--neutral-500)", fontFamily: "var(--font-mono)" }}>{rows.length} rows · {Math.round(34 + Math.random() * 60)}ms</span>
          <Button variant="ghost" size="sm" leftIcon="download">Export</Button>
        </div>

        {/* Result body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 100px" }}>
          {/* When measure has anomaly, show a banner with link to change analysis */}
          {measures[0]?.anomaly && measures[0].anomaly !== "none" && (
            <div onClick={openChangeAnalysis} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 14,
              background: "var(--anomaly-high-bg)", border: "1px solid #fecaca", borderRadius: 10, cursor: "pointer",
            }}>
              <Icon name="alert-triangle" size={16} color="var(--anomaly-high)" />
              <div style={{ flex: 1, fontSize: 13, color: "#991b1b" }}>
                <b>Anomaly detected.</b> {measures[0].label} moved {measures[0].deltaPct > 0 ? "+" : ""}{measures[0].deltaPct}% — much more than its typical range.
              </div>
              <Button variant="outline" size="sm" leftIcon="search-check">Why?</Button>
            </div>
          )}

          {chart === "number" && <NumberView measures={measures} totalRow={totalRow} />}
          {chart === "line" && <LineChart rows={rows} measures={measures} dimensions={dimensions} />}
          {chart === "bar" && <BarChart rows={rows} measures={measures} dimensions={dimensions} />}
          {chart === "table" && (
            <ResultTable
              rows={rows} measures={measures} dimensions={dimensions}
              onDrill={(row) => {
                // Drill — add a filter for the row's dim value
                toast?.(`Drilled into ${row[dimensions[0]?.label]}`, { icon: "filter" });
              }}
            />
          )}
        </div>

        {/* Verb chips — sticky footer */}
        <VerbChipBar
          measures={measures} dimensions={dimensions} segments={segments}
          chipPlacement={tweaks?.chipPlacement || "bottom"}
          onAdd={(action) => {
            if (action.type === "by_dim") {
              setDimensionIds(ids => ids.includes(action.dimId) ? ids : [...ids, action.dimId]);
              if (/log_date|recharge_date/.test(action.dimId)) setChart("line");
              toast?.(`Sliced by ${CATALOG_BY_ID[action.dimId]?.label}`, { icon: "rows-3" });
            }
            if (action.type === "compare") { setComparison(action.label); toast?.(`Comparing ${action.label}`, { icon: "git-compare" }); }
            if (action.type === "filter") { setSegmentIds(ids => ids.includes(action.segId) ? ids : [...ids, action.segId]); toast?.(`Filtered to ${CATALOG_BY_ID[action.segId]?.label}`, { icon: "filter" }); }
            if (action.type === "granularity") setGranularity(action.value);
            if (action.type === "sort") toast?.(`Sorted by ${action.label}`, { icon: "arrow-down-up" });
          }}
        />
      </div>

      {/* Modal: generated SQL */}
      <Modal open={sqlOpen} onClose={() => setSqlOpen(false)} title="Generated SQL" subtitle="Cube emits this SQL for your current selection."
        footer={<><Button variant="ghost" size="sm">GraphQL</Button><Button variant="ghost" size="sm">REST</Button><div style={{ flex: 1 }} /><Button variant="outline" size="sm" leftIcon="copy">Copy SQL</Button></>}
        width={720}
      >
        <pre style={{ margin: 0, padding: 14, background: "var(--neutral-950)", color: "#e5e5e5", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6, overflowX: "auto" }}>
{`SELECT
  ${dimensions.length ? dimensions.map(d => `revenue.${d.member} AS "${d.label}"`).join(",\n  ") + "," : ""}
  ${measures.map(m => `SUM(revenue.${m.member}) AS "${m.label}"`).join(",\n  ")}
FROM revenue
${segments.length ? `WHERE ${segments.map(s => `revenue.${s.member} = TRUE`).join(" AND ")}` : ""}
${dimensions.length ? `GROUP BY ${dimensions.map((_, i) => i + 1).join(", ")}` : ""}
ORDER BY 1 DESC
LIMIT 500;`}
        </pre>
      </Modal>
    </div>
  );
};

// ─── Left rail (concept picker) ────────────────────────────────────
const LeftRail = ({ measureIds, setMeasureIds, dimensionIds, setDimensionIds, segmentIds, setSegmentIds }) => {
  const [q, setQ] = useStateE("");
  const sections = [
    { type: "measure",   ids: measureIds, set: setMeasureIds, label: "Measures" },
    { type: "dimension", ids: dimensionIds, set: setDimensionIds, label: "Dimensions" },
    { type: "segment",   ids: segmentIds, set: setSegmentIds, label: "Segments" },
  ];
  return (
    <aside style={{ width: 280, flexShrink: 0, borderRight: "1px solid var(--border)", background: "#fff", display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        <Input leftIcon="search" placeholder="Filter concepts" value={q} onChange={e => setQ(e.target.value)} size="sm" />
      </div>
      {sections.map(sec => {
        const items = CONCEPTS.filter(c => c.type === sec.type && c.trust !== "deprecated" && c.trust !== "orphaned" && (!q || c.label.toLowerCase().includes(q.toLowerCase())));
        return (
          <div key={sec.type} style={{ padding: "10px 8px", borderBottom: "1px solid var(--neutral-100)" }}>
            <div style={{ padding: "0 6px 6px", display: "flex", alignItems: "center", gap: 6 }}>
              <TypeIcon type={sec.type} size={11} />
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--neutral-700)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{sec.label}</span>
              <span style={{ fontSize: 11, color: "var(--neutral-400)", fontFamily: "var(--font-mono)", marginLeft: "auto" }}>{items.length}</span>
            </div>
            {items.slice(0, 8).map(c => {
              const sel = sec.ids.includes(c.id);
              return (
                <div key={c.id} onClick={() => sec.set(ids => sel ? ids.filter(x => x !== c.id) : [...ids, c.id])} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, cursor: "pointer",
                  background: sel ? "var(--neutral-100)" : "transparent",
                }} onMouseEnter={e => { if (!sel) e.currentTarget.style.background = "var(--neutral-50)"; }} onMouseLeave={e => { if (!sel) e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, border: `1.5px solid ${sel ? "var(--neutral-900)" : "var(--neutral-300)"}`, background: sel ? "var(--neutral-900)" : "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {sel && <Icon name="check" size={8} color="#fff" />}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--neutral-900)", fontWeight: sel ? 500 : 400, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
                  {c.trust === "certified" && <TrustBadge state="certified" prominent="quiet" />}
                  {c.trust === "beta" && <TrustBadge state="beta" prominent="quiet" />}
                </div>
              );
            })}
          </div>
        );
      })}
    </aside>
  );
};

// ─── Selection pill (current query expression chips) ───────────────
const SelectionPill = ({ icon, colorVar, bgVar, label, children }) => (
  <div style={{ display: "inline-flex", alignItems: "stretch", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", overflow: "hidden", height: 28 }}>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "0 8px", background: bgVar, color: colorVar, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
      <Icon name={icon} size={11} />{label}
    </span>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0 8px" }}>{children}</span>
  </div>
);
const ChipItem = ({ label, onRemove }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "0 6px", height: 22, borderRadius: 6, background: "var(--neutral-100)", fontSize: 12, fontWeight: 500, color: "var(--neutral-900)" }}>
    {label}
    {onRemove && <span onClick={onRemove} style={{ cursor: "pointer", display: "inline-flex", color: "var(--neutral-500)" }}><Icon name="x" size={10} /></span>}
  </span>
);
const AddBtn = ({ onClick, label }) => (
  <span onClick={onClick} style={{
    display: "inline-flex", alignItems: "center", gap: 3, padding: "0 6px", height: 22, borderRadius: 6,
    border: "1px dashed var(--neutral-300)", fontSize: 11, fontWeight: 500, color: "var(--neutral-500)", cursor: "pointer",
  }}><Icon name="plus" size={10} /> {label}</span>
);

// ─── Result table ──────────────────────────────────────────────────
const ResultTable = ({ rows, measures, dimensions, onDrill }) => {
  if (rows.length === 0) return <EmptyResult />;
  const cols = [...dimensions, ...measures];
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-sans)" }}>
        <thead>
          <tr style={{ background: "var(--neutral-50)" }}>
            {cols.map(c => (
              <th key={c.id} style={{ textAlign: c.type === "measure" ? "right" : "left", padding: "10px 14px", fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--border)" }}>{c.label}</th>
            ))}
            <th style={{ width: 36, borderBottom: "1px solid var(--border)" }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--neutral-100)" }} className="result-row">
              {cols.map(c => (
                <td key={c.id} style={{ padding: "10px 14px", textAlign: c.type === "measure" ? "right" : "left", fontSize: 13, color: "var(--neutral-900)", fontFamily: c.type === "measure" ? "var(--font-mono)" : "var(--font-sans)", whiteSpace: "nowrap" }}>
                  {r[c.label] ?? "—"}
                  {c.type === "measure" && r[c.label + "_delta"] != null && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: r[c.label + "_delta"] > 0 ? "var(--success)" : "var(--destructive)" }}>{r[c.label + "_delta"] > 0 ? "▲" : "▼"}{Math.abs(r[c.label + "_delta"])}%</span>
                  )}
                </td>
              ))}
              <td style={{ padding: "6px 8px", textAlign: "right" }}>
                <Tooltip content="Drill into row"><Button variant="ghost" size="iconSm" onClick={() => onDrill(r)}><Icon name="filter" size={13} color="var(--neutral-400)" /></Button></Tooltip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const EmptyResult = () => (
  <div style={{ padding: 60, textAlign: "center", color: "var(--neutral-500)" }}>
    <Icon name="search-x" size={32} color="var(--neutral-300)" />
    <div style={{ marginTop: 10, fontSize: 14, fontWeight: 500 }}>No results — pick a measure to start.</div>
  </div>
);

// ─── Big number view ──────────────────────────────────────────────
const NumberView = ({ measures, totalRow }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(measures.length, 3)}, 1fr)`, gap: 16 }}>
    {measures.map(m => (
      <Card key={m.id} padding={20}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 12, color: "var(--neutral-500)", fontWeight: 500 }}>{m.label}</div>
          {m.anomaly && m.anomaly !== "none" && <AnomalyBadge state={m.anomaly} delta={m.deltaPct} />}
        </div>
        <div style={{ marginTop: 10 }}>
          <span style={{ fontFamily: "var(--num-font)", fontWeight: 500, fontSize: 36, color: "var(--neutral-950)", letterSpacing: "-0.03em" }}>
            {formatCompact(totalRow[m.label], m.unit)}
          </span>
          <span style={{ fontSize: 14, color: "var(--neutral-500)", marginLeft: 6 }}>{m.unit}</span>
        </div>
        <div style={{ marginTop: 10 }}>
          <Sparkline data={m.spark || [1,1,1]} width={220} height={36} color="var(--neutral-700)" fillBg="rgba(10,10,10,0.04)" lastPointDot />
        </div>
      </Card>
    ))}
  </div>
);

// ─── Line chart (SVG) ──────────────────────────────────────────────
const LineChart = ({ rows, measures, dimensions }) => {
  const data = measures[0]?.spark || rows.map(r => Number((r[measures[0]?.label] || "0").toString().replace(/[^0-9.-]/g, "")));
  return (
    <Card padding={24}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--neutral-950)" }}>{measures[0]?.label} over time</div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--neutral-500)", fontFamily: "var(--font-mono)" }}>{data.length} data points</span>
      </div>
      <Sparkline data={data} width={680} height={220} color="var(--primary)" fillBg="rgba(240,90,34,0.08)" lastPointDot />
      <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--neutral-500)", fontFamily: "var(--font-mono)" }}>
        <span>May 06</span><span>May 09</span><span>May 12</span><span>May 15</span><span>May 19</span>
      </div>
    </Card>
  );
};

const BarChart = ({ rows, measures, dimensions }) => {
  const label = measures[0]?.label || "";
  const items = rows.slice(0, 8).map(r => ({ k: r[dimensions[0]?.label] || "—", v: Number((r[label] || "0").toString().replace(/[^0-9.-]/g, "")) }));
  const max = Math.max(...items.map(i => i.v), 1);
  return (
    <Card padding={24}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--neutral-950)", marginBottom: 14 }}>{label} by {dimensions[0]?.label || "—"}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map(it => (
          <div key={it.k} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 110, fontSize: 12, color: "var(--neutral-700)", textAlign: "right" }}>{it.k}</span>
            <div style={{ flex: 1, height: 22, background: "var(--neutral-100)", borderRadius: 4, overflow: "hidden", position: "relative" }}>
              <div style={{ height: "100%", width: `${(it.v / max) * 100}%`, background: "var(--primary)" }} />
            </div>
            <span style={{ width: 100, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--neutral-900)", textAlign: "right" }}>{formatCompact(it.v, "")}</span>
          </div>
        ))}
      </div>
    </Card>
  );
};

// ─── Verb chips (the marquee P2 surface) ───────────────────────────
const VerbChipBar = ({ measures, dimensions, segments, onAdd, chipPlacement }) => {
  const [expanded, setExpanded] = useStateE(false);

  // Build reachable verbs based on current context
  const dimSuggestions = ["bb.mf_users.country", "bb.mf_users.channel", "bb.mf_users.platform", "bb.mf_users.payer_tier", "bb.active_daily.log_date"]
    .filter(id => !dimensions.find(d => d.id === id))
    .map(id => CATALOG_BY_ID[id]).filter(Boolean);
  const segSuggestions = ["bb.seg.whales", "bb.seg.vn_only", "bb.seg.lapsed_payer_14d"]
    .filter(id => !segments.find(s => s.id === id))
    .map(id => CATALOG_BY_ID[id]).filter(Boolean);

  const verbs = [
    { id: "by", icon: "rows-3", label: "By", options: dimSuggestions.map(d => ({ label: d.label, action: { type: "by_dim", dimId: d.id } })) },
    { id: "compare", icon: "git-compare", label: "Compare to", options: [
      { label: "Last 7 days", action: { type: "compare", label: "vs last 7d" } },
      { label: "Last 30 days", action: { type: "compare", label: "vs last 30d" } },
      { label: "Same week last year", action: { type: "compare", label: "YoY" } },
    ]},
    { id: "filter", icon: "filter", label: "Filter to", options: segSuggestions.map(s => ({ label: s.label, action: { type: "filter", segId: s.id } })) },
    { id: "granularity", icon: "clock", label: "Granularity", options: ["day","week","month"].map(g => ({ label: g, action: { type: "granularity", value: g } })) },
    { id: "sort", icon: "arrow-down-up", label: "Sort by", options: measures.map(m => ({ label: `${m.label} ↓`, action: { type: "sort", label: m.label } })) },
    { id: "limit", icon: "list-ordered", label: "Limit", options: [10, 25, 50, 100].map(n => ({ label: `Top ${n}`, action: { type: "limit", value: n } })) },
  ];

  const visible = expanded ? verbs : verbs.slice(0, 3);

  return (
    <div style={{
      position: "sticky", bottom: 0, background: "#fff", borderTop: "1px solid var(--border)",
      padding: "12px 20px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      boxShadow: "0 -2px 8px rgba(0,0,0,0.04)",
    }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 4 }}>Next move</span>
      {visible.map(v => (
        <Popover key={v.id} trigger={
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", height: 32, borderRadius: 9999,
            border: "1px solid var(--border)", background: "#fff", fontSize: 13, fontWeight: 500, color: "var(--neutral-900)",
            cursor: "pointer",
          }} onMouseEnter={e => e.currentTarget.style.background = "var(--neutral-50)"} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
            <Icon name={v.icon} size={12} color="var(--neutral-500)" />
            {v.label}
            <Icon name="chevron-down" size={11} color="var(--neutral-400)" />
          </span>
        } width={220}>
          {({ close }) => v.options.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--neutral-500)" }}>Nothing reachable from this query.</div>
          ) : v.options.map((o, i) => (
            <div key={i} onClick={() => { onAdd(o.action); close(); }} style={{ padding: "8px 10px", fontSize: 13, borderRadius: 6, cursor: "pointer", color: "var(--neutral-800)" }} onMouseEnter={e => e.currentTarget.style.background = "var(--neutral-50)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{o.label}</div>
          ))}
        </Popover>
      ))}
      {!expanded && verbs.length > 3 && (
        <span onClick={() => setExpanded(true)} style={{ fontSize: 12, color: "var(--neutral-600)", padding: "6px 10px", cursor: "pointer", borderRadius: 9999 }}>+ {verbs.length - 3} more</span>
      )}
      <div style={{ flex: 1 }} />
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--neutral-400)" }}>
        Tip: chips compose. Each click adds to the query.
      </span>
    </div>
  );
};

// ─── Pseudo-data generation ────────────────────────────────────────
function generateRows(measures, dimensions, segments, period) {
  if (measures.length === 0) return [];
  const m = measures[0];
  if (dimensions.length === 0) {
    return [{ [m.label]: formatCompact(m.current || 1000, m.unit), [m.label + "_delta"]: m.deltaPct }];
  }
  const d = dimensions[0];
  // Synthesize rows by dimension
  const valueLists = {
    "bb.mf_users.country":   ["VN", "TH", "ID", "PH", "MY", "SG", "VND_other"],
    "bb.mf_users.channel":   ["organic", "facebook_ads", "google_ads", "tiktok", "cross_promo", "influencer"],
    "bb.mf_users.platform":  ["ios", "android", "web"],
    "bb.mf_users.payer_tier":["whale", "dolphin", "minnow", "non_payer"],
    "bb.active_daily.log_date":        Array.from({ length: 14 }).map((_, i) => `May ${(6 + i).toString().padStart(2, "0")}`),
    "bb.user_recharge_daily.log_date": Array.from({ length: 14 }).map((_, i) => `May ${(6 + i).toString().padStart(2, "0")}`),
    "bb.recharge.recharge_date":       Array.from({ length: 14 }).map((_, i) => `May ${(6 + i).toString().padStart(2, "0")}`),
  };
  const values = valueLists[d.id] || ["A", "B", "C", "D"];
  const base = (m.current || 1_000_000) / values.length;
  return values.map((v, i) => {
    const variance = (Math.sin(i * 1.7) * 0.4 + Math.random() * 0.2 + 0.8);
    const val = Math.round(base * variance);
    const delta = Math.round((Math.sin(i * 2.3) * 30 + Math.random() * 10 - 5) * 10) / 10;
    return { [d.label]: v, [m.label]: formatCompact(val, m.unit), [m.label + "_delta"]: delta };
  });
}
function generateTotal(measures) {
  const out = {};
  measures.forEach(m => { out[m.label] = m.current || 0; });
  return out;
}
function formatCompact(v, unit) {
  if (typeof v === "string") return v;
  if (v == null) return "—";
  if (unit === "%") return `${Number(v).toFixed(1)}%`;
  if (unit === "x") return Number(v).toFixed(2) + "x";
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + "B";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toLocaleString();
}

Object.assign(window, { ExplorePage });
