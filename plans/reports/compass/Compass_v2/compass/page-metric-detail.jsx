/* global React, Icon, Button, Badge, Input, Tabs, Tooltip, Popover, Card, Avatar, Switch, Sparkline,
   ConceptCard, TrustBadge, Freshness, AnomalyBadge, TypeIcon, TypeChip, DomainChip, DriftWarning,
   FeedbackWidget, UsageChip, OwnerStamp, Metric, TierBadge, LayerBadge, FormulaTokens, ParamPicker,
   CONCEPTS, METRICS, CONCEPT_BY_ID, CATALOG_BY_ID, METRIC_BY_ID, TIER_INFO, CUBES,
   OWNERS, ACTIVITY, LINEAGE, CHANGE_ANALYSIS,
   useNav, useToast, Modal, SectionHeader, Divider */
/* Compass — Detail page. Renders both layers (PRD §5.2):
   • layer="metric" → Metric Detail (5.2.A): formula composes other metrics + building blocks
   • layer="data"   → Building Block Detail (5.2.B): YAML formula, "used in N metrics" */

const { useState: useStateMD, useMemo: useMemoMD } = React;

const MetricDetailPage = ({ id, layer = "metric", tweaks, openSubscribe, openChangeAnalysis, openSaveView }) => {
  const { go } = useNav();
  const toast = useToast();
  const concept = CATALOG_BY_ID[id] || METRICS[0];
  const isMetricLayer = concept.type === "metric";
  const [editMode, setEditMode] = useStateMD(false);
  const [editing, setEditing] = useStateMD(null);
  const [draft, setDraft] = useStateMD(concept);
  const [paramN, setParamN] = useStateMD(concept.parameter?.default || null);
  const [tab, setTab] = useStateMD("overview");
  const owner = OWNERS[concept.owner] || OWNERS.linh;

  const isAuthor = true;
  const editStyle = tweaks?.editStyle || "inline";

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Main scroll area */}
      <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 28px 60px" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
            {isMetricLayer ? (
              <span style={{
                width: 44, height: 44, borderRadius: 10, border: "1px solid var(--border)",
                background: "var(--type-metric-bg)", display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--num-font)", fontWeight: 700, fontSize: 22, color: "var(--neutral-950)", flexShrink: 0,
              }}>ƒ</span>
            ) : <TypeIcon type={concept.type} size={18} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <EditableText
                  value={draft.label} editing={editMode && editing === "label"}
                  onStart={() => setEditing("label")} onCommit={(v) => { setDraft({ ...draft, label: v }); setEditing(null); toast?.("Draft saved", { icon: "save" }); }}
                  inputStyle={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 26, letterSpacing: "-0.02em" }}
                  textStyle={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 26, color: "var(--neutral-950)", letterSpacing: "-0.02em", lineHeight: 1.15 }}
                  canEdit={editMode}
                />
                {concept.parameter && <ParamPicker metric={concept} value={paramN} onChange={setParamN} size="lg" />}
                <LayerBadge layer={isMetricLayer ? "metric" : "data"} />
                {isMetricLayer && <TierBadge tier={concept.tier} prominent="loud" />}
                <TrustBadge state={concept.trust} prominent={tweaks?.trustProminence || "medium"} />
                {concept.drift && <DriftWarning />}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, color: "var(--neutral-500)", fontSize: 13, flexWrap: "wrap" }}>
                {isMetricLayer
                  ? <span style={{ fontFamily: "var(--font-sans)", fontWeight: 500 }}>{concept.standFor}</span>
                  : <TypeChip type={concept.type} />}
                {!isMetricLayer && <span style={{ fontFamily: "var(--font-mono)" }}>{concept.cube}.{concept.member}</span>}
                {isMetricLayer && concept.gdsRef != null && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "1px 6px", border: "1px dashed var(--border)", borderRadius: 4, color: "var(--neutral-500)", whiteSpace: "nowrap" }}>GDS-1.8 #{concept.gdsRef}</span>
                )}
                <Divider vertical style={{ height: 14 }} />
                <DomainChip domain={concept.domain} />
                <Freshness minutesAgo={concept.refreshMinutes || 12} sla={concept.refreshSla || 60} compact />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {isAuthor && editStyle === "explicit" && (
                <Button variant={editMode ? "neutral" : "outline"} size="sm" leftIcon={editMode ? "check" : "pencil-line"} onClick={() => { setEditMode(!editMode); setEditing(null); }}>{editMode ? "Done editing" : "Edit"}</Button>
              )}
              {isAuthor && editStyle === "inline" && (
                <Button variant="outline" size="sm" leftIcon="pencil-line" onClick={() => setEditMode(v => !v)} active={editMode}>{editMode ? "Editing" : "Suggest edit"}</Button>
              )}
              <Button variant="outline" size="sm" leftIcon="bell" onClick={openSubscribe}>Subscribe</Button>
              <Button variant="primary" size="sm" leftIcon="compass" onClick={() => go({ name: "explore", measureId: concept.id })}>Open in Explore</Button>
            </div>
          </div>

          {/* Inline edit mode banner */}
          {editMode && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "var(--blue-50)", border: "1px solid var(--blue-200)", borderRadius: 8, marginBottom: 16 }}>
              <Icon name="pencil-line" size={14} color="#1d4ed8" />
              <div style={{ flex: 1, fontSize: 13, color: "#1e40af" }}>
                <b>Editing mode.</b> Click any field to edit it. Your changes will be submitted as a draft for owner approval.
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditMode(false)}>Exit</Button>
            </div>
          )}

          {/* Headline stats row */}
          <div className="metric-stats-row" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
            <Card padding={16}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 11, color: "var(--neutral-500)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Current · Last 7 days</div>
                {concept.anomaly && concept.anomaly !== "none" && (
                  <AnomalyBadge state={concept.anomaly} delta={concept.deltaPct} onClick={openChangeAnalysis} />
                )}
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 16, marginTop: 8 }}>
                <Metric
                  value={formatNumber(concept.current, concept.unit)}
                  unit={concept.unit === "%" ? "%" : concept.unit === "VND" ? "VND" : concept.unit}
                  delta={concept.deltaPct}
                  deltaPositive={concept.deltaPct > 0}
                  size="lg"
                />
                <Sparkline data={concept.spark || [1,1,1]} width={140} height={36} color="var(--neutral-700)" fillBg="rgba(10,10,10,0.04)" lastPointDot />
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--neutral-500)" }}>vs previous 7-day period</div>
            </Card>

            <Card padding={16}>
              <div style={{ fontSize: 11, color: "var(--neutral-500)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Used in</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                <UsageStat icon="layout-dashboard" label="Dashboards" value={concept.usedIn?.dashboards || 0} />
                <UsageStat icon="bot" label="MCP tools" value={concept.usedIn?.mcp || 0} />
                <UsageStat icon="users" label="CDP audiences" value={concept.usedIn?.cdp || 0} />
                <UsageStat icon="bookmark" label="Saved views" value={concept.usedIn?.savedViews || 0} />
              </div>
            </Card>

            <Card padding={16}>
              <div style={{ fontSize: 11, color: "var(--neutral-500)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Owner & SLA</div>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <OwnerStamp owner={owner} />
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name="timer" size={13} color="var(--neutral-500)" />
                  <span style={{ fontSize: 12, color: "var(--neutral-700)" }}>SLA <b style={{ fontFamily: "var(--font-mono)" }}>{concept.refreshSla || 60}m</b></span>
                  <span style={{ fontSize: 12, color: "var(--neutral-500)" }}>· Refreshed {concept.refreshMinutes || 12}m ago</span>
                </div>
                {concept.certifiedAt && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon name="shield-check" size={13} color="var(--trust-certified)" />
                    <span style={{ fontSize: 12, color: "var(--neutral-700)" }}>Certified <b style={{ fontFamily: "var(--font-mono)" }}>{concept.certifiedAt}</b></span>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Tab strip */}
          <div style={{ borderBottom: "1px solid var(--border)", marginBottom: 18, display: "flex", alignItems: "center", gap: 4 }}>
            {[
              { value: "overview", label: "Overview" },
              { value: "formula",  label: "Formula" },
              { value: "lineage",  label: "Lineage" },
              { value: "slices",   label: "Slices & joins" },
              { value: "activity", label: "Activity", count: ACTIVITY.length },
            ].map(t => (
              <span key={t.value} onClick={() => setTab(t.value)} style={{
                padding: "10px 14px", fontSize: 13, fontWeight: 500, color: tab === t.value ? "var(--neutral-950)" : "var(--neutral-600)",
                borderBottom: `2px solid ${tab === t.value ? "var(--neutral-950)" : "transparent"}`,
                cursor: "pointer", marginBottom: -1, display: "inline-flex", alignItems: "center", gap: 6,
              }}>{t.label}{t.count != null && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--neutral-500)" }}>{t.count}</span>}</span>
            ))}
          </div>

          {tab === "overview" && (
            <OverviewTab concept={concept} draft={draft} setDraft={setDraft} editMode={editMode} editing={editing} setEditing={setEditing} paramN={paramN} setParamN={setParamN} go={go} isMetricLayer={isMetricLayer} />
          )}
          {tab === "formula" && (
            <FormulaTab concept={concept} draft={draft} setDraft={setDraft} editMode={editMode} editing={editing} setEditing={setEditing} isMetricLayer={isMetricLayer} go={go} />
          )}
          {tab === "lineage" && <LineageTab concept={concept} />}
          {tab === "slices" && <SlicesTab concept={concept} go={go} openSaveView={openSaveView} />}
          {tab === "activity" && <ActivityTab concept={concept} />}
        </div>
      </div>

      {/* Right rail — sample questions / synonyms / feedback */}
      <RightRail concept={concept} go={go} openSubscribe={openSubscribe} />
    </div>
  );
};

const formatNumber = (v, unit) => {
  if (v == null) return "—";
  if (unit === "%") return Number(v).toFixed(1);
  if (unit === "x") return Number(v).toFixed(1);
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + "B";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toLocaleString();
};

const UsageStat = ({ icon, label, value }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--neutral-100)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--neutral-700)" }}><Icon name={icon} size={12} /></span>
    <div style={{ lineHeight: 1.2 }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, color: "var(--neutral-950)", fontWeight: 500 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--neutral-500)" }}>{label}</div>
    </div>
  </div>
);

const EditableText = ({ value, editing, onStart, onCommit, canEdit, inputStyle, textStyle, multiline }) => {
  const [v, setV] = useStateMD(value);
  React.useEffect(() => setV(value), [value]);
  if (editing) {
    const Tag = multiline ? "textarea" : "input";
    return (
      <Tag
        autoFocus value={v}
        onChange={e => setV(e.target.value)}
        onBlur={() => onCommit(v)}
        onKeyDown={e => { if (e.key === "Enter" && !multiline) onCommit(v); if (e.key === "Escape") onCommit(value); }}
        style={{
          background: "var(--blue-50)", border: "1px solid var(--blue-300)", borderRadius: 6,
          padding: multiline ? "8px 10px" : "2px 6px", outline: "none", color: "var(--neutral-950)",
          fontFamily: "var(--font-sans)", lineHeight: 1.4, width: multiline ? "100%" : "auto", minWidth: 240,
          resize: multiline ? "vertical" : "none", minHeight: multiline ? 80 : "auto",
          ...inputStyle,
        }} />
    );
  }
  return (
    <span onClick={canEdit ? onStart : undefined} style={{
      ...textStyle,
      cursor: canEdit ? "text" : "default",
      borderRadius: 4, padding: "2px 4px", margin: "-2px -4px",
      background: canEdit ? "transparent" : undefined,
      transition: "background .15s",
      display: multiline ? "block" : "inline",
    }} onMouseEnter={e => { if (canEdit) e.currentTarget.style.background = "rgba(59,130,246,0.05)"; }} onMouseLeave={e => { if (canEdit) e.currentTarget.style.background = "transparent"; }}>
      {value}
      {canEdit && <Icon name="pencil-line" size={11} color="var(--blue-500)" style={{ marginLeft: 6, opacity: 0.5 }} />}
    </span>
  );
};

// ─── OVERVIEW TAB ──────────────────────────────────────────────────
const OverviewTab = ({ concept, draft, setDraft, editMode, editing, setEditing, paramN, setParamN, go, isMetricLayer }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
    {/* Description */}
    <Panel title="Description" icon="text-cursor" badge={editMode && "editable"}>
      <div style={{ fontSize: 14, lineHeight: 1.65, color: "var(--neutral-800)" }}>
        <EditableText
          value={draft.description} editing={editMode && editing === "description"}
          onStart={() => setEditing("description")} onCommit={(v) => { setDraft({ ...draft, description: v }); setEditing(null); }}
          canEdit={editMode} multiline
        />
      </div>
    </Panel>

    {/* Formula in plain English — METRIC LAYER only */}
    {isMetricLayer && concept.formula && (
      <Panel
        title="Formula" icon="function-square"
        description="Plain-English composition. References to other metrics and building blocks are clickable."
        action={<Button variant="ghost" size="sm" leftIcon="code-2" onClick={() => {}}>Show Cube query</Button>}
      >
        <div style={{
          padding: "14px 16px", background: "var(--neutral-50)", border: "1px solid var(--border)", borderRadius: 8,
          fontSize: 15, lineHeight: 1.7, color: "var(--neutral-900)", fontFamily: "var(--font-sans)",
        }}>
          <FormulaTokens text={concept.formula.plain} onTokenClick={(c) => go({ name: c.type === "metric" ? "metric" : "data-model", id: c.id })} />
        </div>
        {/* Composed-of inventory */}
        {(concept.composedOf || []).length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>References</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(concept.composedOf || []).map(refId => {
                const ref = CATALOG_BY_ID[refId];
                if (!ref) return null;
                const refIsMetric = ref.type === "metric";
                return (
                  <div key={refId} onClick={() => go({ name: refIsMetric ? "metric" : "data-model", id: refId })} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                    border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "#fff",
                  }} onMouseEnter={e => e.currentTarget.style.background = "var(--neutral-50)"} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                    {refIsMetric
                      ? <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--type-metric-bg)", border: "1px solid var(--border)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--num-font)", fontWeight: 700, fontSize: 11, color: "var(--neutral-950)", flexShrink: 0 }}>ƒ</span>
                      : <TypeIcon type={ref.type} size={11} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--neutral-950)" }}>{ref.label}</span>
                        {refIsMetric ? <TierBadge tier={ref.tier} prominent="quiet" /> : <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--neutral-500)" }}>{ref.cube}.{ref.member}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--neutral-500)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ref.description}</div>
                    </div>
                    <span style={{ flexShrink: 0, padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: refIsMetric ? "var(--layer-metric-accent)" : "var(--layer-data-accent)", background: refIsMetric ? "rgba(240,90,34,0.08)" : "rgba(63,141,255,0.08)" }}>
                      {refIsMetric ? "Metric" : "Building block"}
                    </span>
                    <Icon name="arrow-up-right" size={13} color="var(--neutral-400)" />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Panel>
    )}

    {/* Parameter picker for parameterised families */}
    {concept.parameter && (
      <Panel title="Parameter" icon="sliders-horizontal" description={`${concept.label} is a parameterised family. Pick a value of ${concept.parameter.name} to materialise it.`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {concept.parameter.values.map(v => (
            <span key={v} onClick={() => setParamN(v)} style={{
              padding: "4px 12px", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500,
              border: `1px solid ${paramN === v ? "var(--neutral-900)" : "var(--border)"}`,
              background: paramN === v ? "var(--neutral-900)" : "#fff", color: paramN === v ? "#fff" : "var(--neutral-700)",
              borderRadius: 6, cursor: "pointer",
            }}>{concept.parameter.name}={v}</span>
          ))}
        </div>
      </Panel>
    )}

    {/* Vocabulary panel */}
    <Panel title="Vocabulary" icon="book-open-text" badge={editMode && "editable"}>
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "12px 16px", fontSize: 13 }}>
        <FieldRow label="Business label">
          <EditableText value={draft.label} editing={editMode && editing === "label2"} onStart={() => setEditing("label2")} onCommit={(v) => { setDraft({...draft, label: v}); setEditing(null); }} canEdit={editMode} textStyle={{ fontWeight: 500, color: "var(--neutral-950)" }} />
        </FieldRow>
        {isMetricLayer && concept.standFor && (
          <FieldRow label="Stand for">
            <span style={{ fontSize: 13, color: "var(--neutral-700)" }}>{concept.standFor}</span>
          </FieldRow>
        )}
        <FieldRow label="Synonyms">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(draft.synonyms || concept.synonyms || []).map(s => (
              <span key={s} style={{
                display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
                fontSize: 12, background: "var(--neutral-100)", borderRadius: 9999, color: "var(--neutral-800)",
              }}>
                {s}
                {editMode && <Icon name="x" size={10} color="var(--neutral-500)" style={{ cursor: "pointer" }} />}
              </span>
            ))}
            {(!concept.synonyms || concept.synonyms.length === 0) && !editMode && (
              <span style={{ fontSize: 12, color: "var(--neutral-400)", fontStyle: "italic" }}>None yet — contribute one</span>
            )}
            {editMode && (
              <span style={{ padding: "2px 8px", fontSize: 12, color: "var(--neutral-500)", border: "1px dashed var(--neutral-300)", borderRadius: 9999, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name="plus" size={11} /> add synonym
              </span>
            )}
          </div>
        </FieldRow>
        {(concept.sampleQuestions || []).length > 0 && (
          <FieldRow label="Sample questions">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(concept.sampleQuestions || []).map((q, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name="help-circle" size={12} color="var(--neutral-500)" />
                  <EditableText value={q} editing={editMode && editing === `sq-${i}`} onStart={() => setEditing(`sq-${i}`)} onCommit={() => setEditing(null)} canEdit={editMode} textStyle={{ fontSize: 13, color: "var(--neutral-800)" }} />
                </div>
              ))}
              {editMode && (
                <span style={{ fontSize: 12, color: "var(--neutral-500)", display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <Icon name="plus" size={12} /> add sample question
                </span>
              )}
            </div>
          </FieldRow>
        )}
        <FieldRow label="Domain"><DomainChip domain={concept.domain} /></FieldRow>
        <FieldRow label="Unit">
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--neutral-700)", padding: "2px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "#fff" }}>{concept.unit}</span>
        </FieldRow>
        {isMetricLayer && concept.tier != null && (
          <FieldRow label="Implementation tier">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TierBadge tier={concept.tier} prominent="medium" />
              <span style={{ fontSize: 13, color: "var(--neutral-600)" }}>{TIER_INFO[concept.tier]?.description}</span>
            </div>
          </FieldRow>
        )}
        {!isMetricLayer && concept.cube && (
          <FieldRow label="Cube">
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--neutral-700)", padding: "2px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "#fff" }}>{concept.cube}</span>
            <span style={{ marginLeft: 8, fontSize: 12, color: "var(--neutral-500)" }}>{CUBES[concept.cube]?.grain}</span>
          </FieldRow>
        )}
      </div>
    </Panel>

    {/* Building Block extension: "Used in N metrics" reverse reference */}
    {!isMetricLayer && (
      <Panel title="Used in metrics" icon="link-2" description="Metric-layer definitions that reference this building block.">
        <UsedInMetrics conceptId={concept.id} go={go} />
      </Panel>
    )}
  </div>
);

const UsedInMetrics = ({ conceptId, go }) => {
  const referencing = METRICS.filter(m => (m.composedOf || []).includes(conceptId));
  if (referencing.length === 0) {
    return <div style={{ padding: "16px 0", fontSize: 13, color: "var(--neutral-500)", textAlign: "center" }}>No metric-layer formulas reference this building block yet.</div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
      {referencing.map(m => (
        <div key={m.id} onClick={() => go({ name: "metric", id: m.id })} style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
          border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "#fff",
        }} onMouseEnter={e => e.currentTarget.style.background = "var(--neutral-50)"} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
          <span style={{ width: 24, height: 24, borderRadius: 6, background: "var(--type-metric-bg)", border: "1px solid var(--border)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--num-font)", fontWeight: 700, fontSize: 12, color: "var(--neutral-950)" }}>ƒ</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--neutral-950)" }}>{m.label}</div>
            <div style={{ fontSize: 11, color: "var(--neutral-500)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.formula?.plain}</div>
          </div>
          <TierBadge tier={m.tier} prominent="quiet" />
        </div>
      ))}
    </div>
  );
};

const Panel = ({ title, icon, description, badge, action, children }) => (
  <section style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
    <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 14, gap: 10 }}>
      <span style={{ width: 26, height: 26, borderRadius: 6, background: "var(--neutral-100)", color: "var(--neutral-700)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={14} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 14, color: "var(--neutral-950)", letterSpacing: "-0.005em" }}>{title}</h3>
          {badge === "editable" && <Badge variant="info" leftIcon="pencil-line" style={{ fontSize: 10 }}>Editable</Badge>}
        </div>
        {description && <div style={{ fontSize: 12, color: "var(--neutral-500)", marginTop: 2 }}>{description}</div>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

const FieldRow = ({ label, children }) => (
  <>
    <div style={{ fontSize: 12, color: "var(--neutral-500)", fontWeight: 500, paddingTop: 4 }}>{label}</div>
    <div>{children}</div>
  </>
);

// ─── FORMULA TAB ───────────────────────────────────────────────────
const FormulaTab = ({ concept, draft, setDraft, editMode, editing, setEditing, isMetricLayer, go }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
    {isMetricLayer ? (
      <Panel title="Business formula" icon="function-square" description="Plain-English composition. References resolve to other metrics or building blocks." badge={editMode && "editable"}>
        <div style={{
          padding: "14px 16px", background: "var(--neutral-50)", border: "1px solid var(--border)", borderRadius: 8,
          fontSize: 15, lineHeight: 1.7, color: "var(--neutral-900)",
        }}>
          <FormulaTokens text={concept.formula?.plain || "—"} onTokenClick={(c) => go({ name: c.type === "metric" ? "metric" : "data-model", id: c.id })} />
        </div>
        {concept.notes && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, fontSize: 12, color: "#92400e" }}>
            <Icon name="info" size={11} style={{ marginRight: 6 }} />{concept.notes}
          </div>
        )}
      </Panel>
    ) : (
      <Panel title="Cube SQL" icon="calculator" description="The SQL expression generated from this building block's YAML." badge={editMode && "editable"}>
        <div style={{ padding: 14, background: "var(--neutral-50)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 14, fontFamily: "var(--font-sans)", lineHeight: 1.7, color: "var(--neutral-900)" }}>
          <MarkdownLite text={concept.formulaText || "—"} />
        </div>
      </Panel>
    )}

    {/* Compiled Cube query — for metrics; raw YAML for building blocks */}
    {isMetricLayer ? (
      <Panel title="Compiled Cube query" icon="code-2" description="What Explore actually runs. Read-only — generated from the formula." action={<Button variant="ghost" size="sm" leftIcon="copy">Copy JSON</Button>}>
        <pre style={{
          margin: 0, padding: 14, background: "var(--neutral-950)", color: "#e5e5e5",
          borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6,
          overflowX: "auto",
        }}>
{JSON.stringify(concept.cubeQuery || {}, null, 2)}
        </pre>
      </Panel>
    ) : (
      <Panel title="Cube YAML" icon="code-2" description="The source of truth — generated by the wizard, edited in version control." action={<Button variant="ghost" size="sm" leftIcon="copy">Copy</Button>}>
        <pre style={{
          margin: 0, padding: 14, background: "var(--neutral-950)", color: "#e5e5e5",
          borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6,
          overflowX: "auto",
        }}>
{`${concept.type}s:
  ${concept.member}:
    sql: "{CUBE}.${concept.member}"
    type: ${concept.type === "measure" ? "count_distinct_approx" : "string"}
    title: "${concept.label}"
    description: |
      ${(concept.description || "").slice(0, 80)}…
    meta:
      domain: ${concept.domain}
      trust: ${concept.trust}
      owner: ${concept.owner}
      synonyms: [${(concept.synonyms || []).map(s => `"${s}"`).join(", ")}]`}
      </pre>
    </Panel>
    )}
  </div>
);

// Tiny markdown-lite: backticks and bold
const MarkdownLite = ({ text }) => {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((p, i) => {
        if (/^`[^`]+`$/.test(p)) return <code key={i} style={{ fontFamily: "var(--font-mono)", fontSize: 13, background: "#fff", padding: "1px 5px", borderRadius: 4, border: "1px solid var(--border)" }}>{p.slice(1, -1)}</code>;
        if (/^\*\*[^*]+\*\*$/.test(p)) return <b key={i}>{p.slice(2, -2)}</b>;
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
};

// ─── LINEAGE TAB ───────────────────────────────────────────────────
const LineageTab = ({ concept }) => {
  const data = LINEAGE[concept.id];
  if (!data) {
    return <Panel title="Lineage" icon="git-branch" description="Upstream sources and downstream consumers will appear here.">
      <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--neutral-500)", fontSize: 13 }}>No lineage indexed yet for this concept.</div>
    </Panel>;
  }
  return (
    <Panel title="Lineage" icon="git-branch" description="Where the data comes from and who consumes it. Click any node to navigate.">
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: 18, alignItems: "stretch", padding: "8px 4px" }}>
        <Column title="Upstream" nodes={data.upstream} />
        <Connector />
        <Column title="This concept" nodes={[{ id: concept.id, type: "concept", label: concept.label, meta: `${concept.cube}.${concept.member}` }]} highlight />
        <Connector />
        <Column title="Downstream" nodes={data.downstream} />
      </div>

      {data.composed && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px dashed var(--border)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>This concept is used in formulas</div>
          {data.composed.map(c => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--neutral-100)" }}>
              <Icon name="function-square" size={13} color="var(--neutral-500)" />
              <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--neutral-700)" }}>{c.label}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};

const NODE_ICON = { warehouse_table: "database", cube: "package", concept: "sigma", saved_view: "bookmark", dashboard: "layout-dashboard", mcp_tool: "bot", cdp_audience: "users" };
const Column = ({ title, nodes, highlight }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{title}</div>
    {nodes.map(n => (
      <div key={n.id} style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
        background: highlight ? "var(--neutral-950)" : "#fff", color: highlight ? "#fff" : "var(--neutral-900)",
        border: `1px solid ${highlight ? "var(--neutral-950)" : "var(--border)"}`,
        borderRadius: 8, cursor: "pointer",
      }}>
        <Icon name={NODE_ICON[n.type] || "circle"} size={13} color={highlight ? "var(--orange-400)" : "var(--neutral-500)"} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</div>
          {n.meta && <div style={{ fontSize: 11, color: highlight ? "rgba(255,255,255,0.6)" : "var(--neutral-500)" }}>{n.meta}</div>}
        </div>
      </div>
    ))}
  </div>
);
const Connector = () => (
  <div style={{ display: "flex", alignItems: "center", color: "var(--neutral-300)" }}>
    <Icon name="arrow-right" size={14} />
  </div>
);

// ─── SLICES & JOINS TAB ────────────────────────────────────────────
const SlicesTab = ({ concept, go, openSaveView }) => {
  const slices = (concept.sliceable || []).map(s => CATALOG_BY_ID[s] || { id: s, label: s.replace(/^bb\./, "").replace(/_/g, " "), type: "dimension" });
  const segs   = (concept.joinableSegments || []).map(s => CATALOG_BY_ID[s]).filter(Boolean);
  const sims   = (concept.similar || []).map(id => CATALOG_BY_ID[id]).filter(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {slices.length > 0 && (
        <Panel title="How to slice" icon="rows-3" description="Common dimension combos. One click lands in Explore with the slice applied.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
            {slices.map(s => (
              <div key={s.id} onClick={() => go({ name: "explore", measureId: concept.id, dimensionId: s.id })} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "#fff",
                transition: "all .15s",
              }} onMouseEnter={e => { e.currentTarget.style.background = "var(--type-dim-bg)"; e.currentTarget.style.borderColor = "var(--type-dim)"; }} onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "var(--border)"; }}>
                <TypeIcon type="dimension" size={12} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--neutral-900)" }}>By {s.label}</div>
                  {s.cube && <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--neutral-500)" }}>{s.cube}.{s.member}</div>}
                </div>
                <Icon name="arrow-up-right" size={13} color="var(--neutral-400)" />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {segs.length > 0 && (
        <Panel title="Joinable segments" icon="filter" description="Segments that filter the user population this metric runs over.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
            {segs.map(s => (
              <div key={s.id} onClick={() => go({ name: "data-model", id: s.id })} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: "#fff",
              }} onMouseEnter={e => { e.currentTarget.style.background = "var(--type-segment-bg)"; e.currentTarget.style.borderColor = "var(--type-segment)"; }} onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "var(--border)"; }}>
                <TypeIcon type="segment" size={12} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--neutral-900)" }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: "var(--neutral-500)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.description}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {sims.length > 0 && (
        <Panel title="Similar concepts" icon="copy" description="Related items you might also want to compare or use instead.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
            {sims.map(s => (
              <ConceptCard key={s.id} concept={s} variant="list" onClick={() => go({ name: s.type === "metric" ? "metric" : "data-model", id: s.id })} />
            ))}
          </div>
        </Panel>
      )}

      {slices.length === 0 && segs.length === 0 && sims.length === 0 && (
        <Panel title="Slices & joins" icon="rows-3">
          <div style={{ padding: "24px 0", textAlign: "center", color: "var(--neutral-500)", fontSize: 13 }}>No dimensions or segments curated for this item yet.</div>
        </Panel>
      )}
    </div>
  );
};

// ─── ACTIVITY TAB ──────────────────────────────────────────────────
const ActivityTab = ({ concept }) => (
  <Panel title="Activity" icon="history" description="Edits, feedback, saves, and approvals for this concept.">
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {ACTIVITY.map(a => {
        const owner = OWNERS[a.actor];
        return (
          <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--neutral-100)" }}>
            <Avatar name={owner.name} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "var(--neutral-900)" }}>
                <b style={{ fontWeight: 600 }}>{owner.name}</b>
                {a.type === "edit"     && " edited"}
                {a.type === "feedback" && (a.verdict === "up" ? " 👍 endorsed" : " 👎 raised a concern")}
                {a.type === "save"     && " saved a view"}
                {a.type === "publish"  && " published"}
              </div>
              <div style={{ fontSize: 13, color: "var(--neutral-700)", marginTop: 4 }}>{a.text}</div>
              <div style={{ fontSize: 11, color: "var(--neutral-500)", marginTop: 4 }}>{a.at}</div>
            </div>
            <Badge variant={a.type === "feedback" ? (a.verdict === "up" ? "success" : "warning") : a.type === "publish" ? "brand" : "secondary"}>
              {a.type}
            </Badge>
          </div>
        );
      })}
    </div>
  </Panel>
);

// ─── RIGHT RAIL ────────────────────────────────────────────────────
const RightRail = ({ concept, go, openSubscribe }) => (
  <aside className="metric-right-rail" style={{ width: 280, flexShrink: 0, borderLeft: "1px solid var(--border)", background: "#fff", overflowY: "auto", padding: 18 }}>
    <RailSection title="Quick actions">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <RailAction icon="compass"   label="Open in Explore" onClick={() => go({ name: "explore", measureId: concept.id })} />
        <RailAction icon="bell"      label="Subscribe" onClick={openSubscribe} />
        <RailAction icon="bot"       label="Use in MCP tool" />
        <RailAction icon="users"     label="Push to CDP audience" />
        <RailAction icon="share-2"   label="Copy link" />
      </div>
    </RailSection>

    <RailSection title="Trust">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><TrustBadge state={concept.trust} prominent="loud" /></div>
        <div style={{ fontSize: 12, color: "var(--neutral-600)", lineHeight: 1.5 }}>
          {concept.trust === "certified" && "Owner-approved. Safe to use in dashboards, MCP tools, CDP audiences."}
          {concept.trust === "beta" && "Newer concept. Logic is sound but usage is still developing."}
          {concept.trust === "draft" && "Author-only draft. Not yet ready for shared use."}
          {concept.trust === "deprecated" && "Being phased out. Migrate consumers off this concept."}
          {concept.trust === "orphaned" && "Metadata references a cube member that no longer exists."}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "var(--neutral-50)", borderRadius: 6, fontSize: 12, color: "var(--neutral-600)" }}>
          <Icon name="thumbs-up" size={12} color="var(--success)" /> <b style={{ color: "var(--neutral-900)" }}>12</b>
          <Icon name="thumbs-down" size={12} color="var(--destructive)" style={{ marginLeft: 8 }} /> <b style={{ color: "var(--neutral-900)" }}>2</b>
        </div>
      </div>
    </RailSection>

    {(concept.sampleQuestions || []).length > 0 && (
      <RailSection title="Try asking">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {(concept.sampleQuestions || []).map((q, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, color: "var(--neutral-800)", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = "var(--neutral-50)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <Icon name="help-circle" size={12} color="var(--neutral-400)" />
              <span style={{ flex: 1, lineHeight: 1.4 }}>{q}</span>
              <Icon name="arrow-up-right" size={12} color="var(--neutral-400)" />
            </div>
          ))}
        </div>
      </RailSection>
    )}

    <RailSection title="Feedback">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 12, color: "var(--neutral-600)" }}>Was this concept's metadata clear?</div>
        <FeedbackWidget />
      </div>
    </RailSection>
  </aside>
);

const RailSection = ({ title, children }) => (
  <div style={{ marginBottom: 22 }}>
    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>{title}</div>
    {children}
  </div>
);

const RailAction = ({ icon, label, onClick }) => (
  <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "var(--neutral-800)" }} onMouseEnter={e => e.currentTarget.style.background = "var(--neutral-50)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
    <Icon name={icon} size={14} color="var(--neutral-600)" /> <span style={{ flex: 1 }}>{label}</span>
    <Icon name="arrow-right" size={12} color="var(--neutral-400)" />
  </div>
);

Object.assign(window, { MetricDetailPage });
