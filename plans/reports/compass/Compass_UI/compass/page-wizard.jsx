/* global React, Icon, Button, Badge, Input, Card, Tooltip, Popover, Switch,
   TypeIcon, TypeChip, DomainChip, DriftWarning, TrustBadge,
   CONCEPTS, CONCEPT_BY_ID, DOMAIN_INFO, useNav, useToast */
/* Compass — New Concept Wizard. PRD §5.4. Six-step flow with metadata at the end.
   Branches by concept type (measure | dimension | segment). */

const { useState: useStateW } = React;

const WIZARD_TYPES = [
  { value: "measure",   icon: "sigma", title: "Measure",   blurb: "A number you compute — revenue, ARPPU, DAU." },
  { value: "dimension", icon: "rows-3", title: "Dimension", blurb: "A slicer — country, channel, platform." },
  { value: "segment",   icon: "filter", title: "Segment",   blurb: "A user filter — whales, lapsed payers." },
];

const STEPS = [
  { id: "type",     label: "Type",     icon: "shapes" },
  { id: "source",   label: "Source",   icon: "database" },
  { id: "logic",    label: "Logic",    icon: "function-square" },
  { id: "format",   label: "Format",   icon: "ruler" },
  { id: "preview",  label: "Preview",  icon: "eye" },
  { id: "metadata", label: "Metadata", icon: "book-open-text" },
];

const WizardPage = () => {
  const { go } = useNav();
  const toast = useToast();
  const [step, setStep] = useStateW(0);
  const [type, setType] = useStateW("measure");
  const [draft, setDraft] = useStateW({
    member: "", label: "", description: "", domain: "revenue",
    synonyms: [], sampleQuestions: [], driftFromCanonical: false,
  });
  const [synInput, setSynInput] = useStateW("");
  const [sqInput, setSqInput] = useStateW("");

  const onPublish = () => {
    toast?.("Concept published — YAML + metadata written atomically", { icon: "rocket" });
    go({ name: "metric", id: "revenue.total_vnd" });
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 28px 60px" }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 22, color: "var(--neutral-950)", letterSpacing: "-0.02em" }}>New concept</h1>
        <div style={{ fontSize: 13, color: "var(--neutral-600)", marginTop: 4 }}>Author a measure, dimension, or segment. Both YAML and the catalog entry are written atomically.</div>
      </div>

      <Stepper steps={STEPS} active={step} onStep={setStep} />

      <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 28, minHeight: 380, marginTop: 18 }}>
        {step === 0 && <TypeStep type={type} setType={setType} />}
        {step === 1 && <SourceStep type={type} draft={draft} setDraft={setDraft} />}
        {step === 2 && <LogicStep type={type} draft={draft} setDraft={setDraft} />}
        {step === 3 && <FormatStep draft={draft} setDraft={setDraft} />}
        {step === 4 && <PreviewStep type={type} draft={draft} />}
        {step === 5 && <MetadataStep type={type} draft={draft} setDraft={setDraft} synInput={synInput} setSynInput={setSynInput} sqInput={sqInput} setSqInput={setSqInput} />}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
        <Button variant="ghost" size="md" onClick={() => go({ name: "catalog" })}>Cancel</Button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--neutral-500)" }}>Step {step + 1} of {STEPS.length}</span>
        <Button variant="outline" size="md" disabled={step === 0} onClick={() => setStep(s => Math.max(0, s - 1))}>Back</Button>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" size="md" rightIcon="arrow-right" onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}>Continue</Button>
        ) : (
          <Button variant="primary" size="md" leftIcon="rocket" onClick={onPublish}>Publish concept</Button>
        )}
      </div>
    </div>
  );
};

const Stepper = ({ steps, active, onStep }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 0, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 6 }}>
    {steps.map((s, i) => {
      const done = i < active, current = i === active;
      return (
        <React.Fragment key={s.id}>
          <span onClick={() => onStep(i)} style={{
            display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, cursor: "pointer",
            background: current ? "var(--neutral-950)" : "transparent",
            color: current ? "#fff" : done ? "var(--neutral-900)" : "var(--neutral-500)",
            fontSize: 13, fontWeight: 500,
          }}>
            <span style={{
              width: 20, height: 20, borderRadius: 9999, fontSize: 11, fontFamily: "var(--font-mono)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: current ? "rgba(255,255,255,0.12)" : done ? "var(--success)" : "var(--neutral-100)",
              color: current ? "#fff" : done ? "#fff" : "var(--neutral-500)",
            }}>{done ? <Icon name="check" size={11} /> : i + 1}</span>
            {s.label}
          </span>
          {i < steps.length - 1 && <Icon name="chevron-right" size={12} color="var(--neutral-300)" style={{ margin: "0 2px" }} />}
        </React.Fragment>
      );
    })}
  </div>
);

const TypeStep = ({ type, setType }) => (
  <div>
    <H2>What kind of concept are you authoring?</H2>
    <Help>Compass authors three kinds. They share the same metadata shape but route through different steps next.</Help>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 18 }}>
      {WIZARD_TYPES.map(t => (
        <div key={t.value} onClick={() => setType(t.value)} style={{
          padding: 18, border: `1.5px solid ${type === t.value ? "var(--neutral-950)" : "var(--border)"}`,
          background: type === t.value ? "var(--neutral-50)" : "#fff", borderRadius: 12, cursor: "pointer",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <TypeIcon type={t.value} size={16} />
          <div style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 15, color: "var(--neutral-950)" }}>{t.title}</div>
          <div style={{ fontSize: 12, color: "var(--neutral-600)", lineHeight: 1.5 }}>{t.blurb}</div>
        </div>
      ))}
    </div>

    <div style={{ marginTop: 22, padding: 12, background: "var(--blue-50)", border: "1px solid var(--blue-200)", borderRadius: 8, display: "flex", gap: 10, alignItems: "flex-start" }}>
      <Icon name="info" size={14} color="#1d4ed8" style={{ marginTop: 2 }} />
      <div style={{ fontSize: 13, color: "#1e40af", lineHeight: 1.5 }}>
        <b>Starting from GDS-1.8?</b> If you're authoring a canonical concept (e.g. `paying_users`), Compass pre-fills the description and formula. You can override and Compass will flag your version as <i>drifted</i>.
      </div>
    </div>
  </div>
);

const SourceStep = ({ type, draft, setDraft }) => (
  <div>
    <H2>Source cube</H2>
    <Help>Which Cube YAML owns the underlying SQL?</Help>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 16 }}>
      {["revenue", "users", "sessions", "payments"].map(c => (
        <div key={c} onClick={() => setDraft({ ...draft, cube: c })} style={{
          display: "flex", flexDirection: "column", gap: 6, padding: 14, borderRadius: 10,
          border: `1.5px solid ${draft.cube === c ? "var(--neutral-950)" : "var(--border)"}`, cursor: "pointer", background: "#fff",
        }}>
          <Icon name="package" size={14} color="var(--neutral-700)" />
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--neutral-950)" }}>{c}</div>
          <div style={{ fontSize: 11, color: "var(--neutral-500)", fontFamily: "var(--font-mono)" }}>cube_{c}.yaml</div>
        </div>
      ))}
    </div>

    <div style={{ marginTop: 22 }}>
      <Label>Internal name</Label>
      <Input value={draft.member} onChange={e => setDraft({ ...draft, member: e.target.value })} placeholder="e.g. total_vnd, payer_tier, whales" style={{ maxWidth: 480 }} />
      <div style={{ fontSize: 11, color: "var(--neutral-500)", marginTop: 4 }}>Used in YAML and the Cube REST API. snake_case.</div>
    </div>
  </div>
);

const LogicStep = ({ type, draft, setDraft }) => (
  <div>
    <H2>Logic</H2>
    <Help>{type === "measure" ? "Pick an aggregation and a source column." : type === "dimension" ? "Pick a column and how it's typed." : "Define the filter predicate."}</Help>

    {type === "measure" && (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
        <div>
          <Label>Aggregation</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["sum", "count", "count_distinct", "avg", "min", "max"].map(a => (
              <span key={a} onClick={() => setDraft({ ...draft, agg: a })} style={{
                padding: "5px 10px", border: `1px solid ${draft.agg === a ? "var(--neutral-900)" : "var(--border)"}`,
                background: draft.agg === a ? "var(--neutral-900)" : "#fff", color: draft.agg === a ? "#fff" : "var(--neutral-800)",
                borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "var(--font-mono)",
              }}>{a}</span>
            ))}
          </div>
        </div>
        <div>
          <Label>Source column</Label>
          <Input value={draft.sourceCol} onChange={e => setDraft({ ...draft, sourceCol: e.target.value })} placeholder="payments.amount_vnd" />
        </div>
      </div>
    )}

    <div style={{ marginTop: 18 }}>
      <Label>Where clause (optional)</Label>
      <textarea value={draft.where || ""} onChange={e => setDraft({ ...draft, where: e.target.value })} placeholder="status = 'completed' AND refunded_at IS NULL" style={{
        width: "100%", minHeight: 90, padding: 12, fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.5,
        border: "1px solid var(--border)", borderRadius: 8, resize: "vertical", outline: "none", color: "var(--neutral-900)",
      }} />
    </div>
  </div>
);

const FormatStep = ({ draft, setDraft }) => (
  <div>
    <H2>Format & unit</H2>
    <Help>How should this concept display in dashboards, digests, and Slack?</Help>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
      <div>
        <Label>Unit</Label>
        <Input value={draft.unit || ""} onChange={e => setDraft({ ...draft, unit: e.target.value })} placeholder="VND · % · users · sessions · …" />
      </div>
      <div>
        <Label>Decimal places</Label>
        <Input type="number" value={draft.decimals ?? 0} onChange={e => setDraft({ ...draft, decimals: +e.target.value })} placeholder="0" />
      </div>
    </div>
  </div>
);

const PreviewStep = ({ type, draft }) => (
  <div>
    <H2>Preview</H2>
    <Help>Compass runs your logic against the last 24 hours so you can sanity-check before publishing.</Help>
    <div style={{ background: "var(--neutral-50)", border: "1px solid var(--border)", borderRadius: 10, padding: 20, marginTop: 16 }}>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Sample run</div>
          <div style={{ marginTop: 8 }}>
            <span style={{ fontFamily: "var(--num-font)", fontWeight: 500, fontSize: 36, color: "var(--neutral-950)" }}>1.42B</span>
            <span style={{ fontSize: 14, color: "var(--neutral-500)", marginLeft: 6 }}>{draft.unit || "value"}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--neutral-500)", marginTop: 8, fontFamily: "var(--font-mono)" }}>SELECT {draft.agg || "sum"}({draft.sourceCol || "<col>"}) ... ran in 142ms</div>
        </div>
      </div>
    </div>
  </div>
);

const MetadataStep = ({ type, draft, setDraft, synInput, setSynInput, sqInput, setSqInput }) => {
  const addSyn = () => { if (!synInput.trim()) return; setDraft({ ...draft, synonyms: [...(draft.synonyms || []), synInput.trim()] }); setSynInput(""); };
  const removeSyn = (s) => setDraft({ ...draft, synonyms: draft.synonyms.filter(x => x !== s) });
  const addSq = () => { if (!sqInput.trim()) return; setDraft({ ...draft, sampleQuestions: [...(draft.sampleQuestions || []), sqInput.trim()] }); setSqInput(""); };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <H2 inline>Catalog metadata</H2>
        <Badge variant="brand" leftIcon="sparkles">New</Badge>
      </div>
      <Help>This is what consumers see in the catalog. Treat it as product copy — clarity matters more than completeness.</Help>

      {draft.driftFromCanonical && (
        <div style={{ marginTop: 14, padding: "10px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Icon name="git-fork" size={14} color="#b45309" />
          <div style={{ flex: 1, fontSize: 13, color: "#92400e" }}>
            <b>Your description differs from GDS-1.8.</b> The canonical version says: <i>"…amount_vnd may include partial refunds for some games."</i> If this is intentional, Compass will flag the concept as <b>drifted</b> in the catalog.
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Business label" required>
            <Input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} placeholder="Revenue (VND)" />
          </Field>
          <Field label="Domain" required>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.keys(DOMAIN_INFO).filter(d => d !== "custom").map(d => (
                <span key={d} onClick={() => setDraft({ ...draft, domain: d })} style={{
                  padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
                  background: draft.domain === d ? DOMAIN_INFO[d].bg : "#fff", color: draft.domain === d ? DOMAIN_INFO[d].color : "var(--neutral-700)",
                  border: `1px solid ${draft.domain === d ? DOMAIN_INFO[d].color : "var(--border)"}`,
                }}>{DOMAIN_INFO[d].label}</span>
              ))}
            </div>
          </Field>
          <Field label="Description" required>
            <textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Sum of completed transactions in VND. Excludes refunds." style={{
              width: "100%", minHeight: 90, padding: 12, fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.6,
              border: "1px solid var(--border)", borderRadius: 8, resize: "vertical", outline: "none", color: "var(--neutral-900)",
            }} />
          </Field>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Synonyms" hint="Comma-separated. These power catalog search.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
              {(draft.synonyms || []).map(s => (
                <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", fontSize: 12, background: "var(--neutral-100)", borderRadius: 9999, color: "var(--neutral-800)" }}>
                  {s} <span onClick={() => removeSyn(s)} style={{ cursor: "pointer", color: "var(--neutral-500)" }}><Icon name="x" size={10} /></span>
                </span>
              ))}
            </div>
            <Input value={synInput} onChange={e => setSynInput(e.target.value)} placeholder="recharge, income, doanh thu" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSyn(); } }} rightSlot={<Button variant="ghost" size="iconSm" onClick={addSyn}><Icon name="plus" size={12} /></Button>} />
          </Field>

          <Field label="Sample questions" hint="Phrases a non-tech user might type. Surfaces in catalog hover & smart search.">
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
              {(draft.sampleQuestions || []).map((q, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}>
                  <Icon name="help-circle" size={11} color="var(--neutral-400)" />
                  <span style={{ flex: 1 }}>{q}</span>
                  <span onClick={() => setDraft({ ...draft, sampleQuestions: draft.sampleQuestions.filter((_, x) => x !== i) })} style={{ cursor: "pointer", color: "var(--neutral-400)" }}><Icon name="x" size={11} /></span>
                </div>
              ))}
            </div>
            <Input value={sqInput} onChange={e => setSqInput(e.target.value)} placeholder="What's revenue in VN last 7 days?" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSq(); } }} rightSlot={<Button variant="ghost" size="iconSm" onClick={addSq}><Icon name="plus" size={12} /></Button>} />
          </Field>

          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8 }}>
            <Switch checked={draft.driftFromCanonical} onChange={v => setDraft({ ...draft, driftFromCanonical: v })} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--neutral-900)" }}>Drift from GDS-1.8 canonical</div>
              <div style={{ fontSize: 11, color: "var(--neutral-500)" }}>Flag this concept as intentionally divergent for this game.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const H2 = ({ children, inline }) => <h2 style={{ margin: 0, fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 18, color: "var(--neutral-950)", letterSpacing: "-0.015em", display: inline ? "inline" : "block" }}>{children}</h2>;
const Help = ({ children }) => <div style={{ fontSize: 13, color: "var(--neutral-600)", marginTop: 6 }}>{children}</div>;
const Label = ({ children }) => <div style={{ fontSize: 12, color: "var(--neutral-700)", fontWeight: 500, marginBottom: 6 }}>{children}</div>;
const Field = ({ label, hint, required, children }) => (
  <div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
      <span style={{ fontSize: 12, color: "var(--neutral-700)", fontWeight: 500 }}>{label}{required && <span style={{ color: "var(--destructive)", marginLeft: 3 }}>*</span>}</span>
      {hint && <span style={{ fontSize: 11, color: "var(--neutral-500)" }}>{hint}</span>}
    </div>
    {children}
  </div>
);

Object.assign(window, { WizardPage });
