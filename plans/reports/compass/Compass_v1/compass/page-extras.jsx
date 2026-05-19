/* global React, Icon, Button, Badge, Input, Card, Tooltip, Switch, Sparkline, Avatar, Modal, Tabs, Divider,
   ConceptCard, TrustBadge, Freshness, AnomalyBadge, TypeIcon, DomainChip, FeedbackWidget, Metric,
   CONCEPTS, CONCEPT_BY_ID, OWNERS, NOTIFICATIONS, SAVED_VIEWS, CHANGE_ANALYSIS,
   useNav, useToast */

const { useState: useStatePg } = React;

// ─── Saved Views page ─────────────────────────────────────────────
const SavedViewsPage = () => {
  const { go } = useNav();
  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 22, color: "var(--neutral-950)", letterSpacing: "-0.02em" }}>Saved Views</h1>
          <div style={{ fontSize: 13, color: "var(--neutral-600)", marginTop: 4 }}>Your re-runnable explorations. Each captures the chip sequence + filters + chart type.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="outline" size="sm" leftIcon="filter">All views</Button>
          <Button variant="primary" size="sm" leftIcon="plus" onClick={() => go({ name: "explore" })}>New view</Button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {SAVED_VIEWS.map(v => {
          const m = CONCEPT_BY_ID[v.measures[0]];
          return (
            <div key={v.id} onClick={() => go({ name: "explore", measureId: v.measures[0], dimensionId: v.dimensions[0] })} style={{
              background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 16, cursor: "pointer",
              display: "flex", flexDirection: "column", gap: 10,
            }} onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--neutral-300)"; e.currentTarget.style.boxShadow = "var(--shadow-sm)"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="bookmark" size={14} color="var(--neutral-500)" />
                <span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 14, color: "var(--neutral-950)", flex: 1 }}>{v.name}</span>
                <Tooltip content="More"><Button variant="ghost" size="iconSm"><Icon name="more-horizontal" size={14} /></Button></Tooltip>
              </div>

              <Sparkline data={m?.spark || [1,1,1]} width={300} height={48} color="var(--primary)" fillBg="rgba(240,90,34,0.08)" />

              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {v.measures.map(id => { const c = CONCEPT_BY_ID[id]; return c && <Badge key={id} variant="outline" leftIcon="sigma">{c.label}</Badge>; })}
                {v.dimensions.map(id => { const c = CONCEPT_BY_ID[id]; return c && <Badge key={id} variant="outline" leftIcon="rows-3">by {c.label}</Badge>; })}
                {v.filters.map(id => { const c = CONCEPT_BY_ID[id]; return c && <Badge key={id} variant="outline" leftIcon="filter">{c.label}</Badge>; })}
                {v.comparison && <Badge variant="outline" leftIcon="git-compare">{v.comparison}</Badge>}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, borderTop: "1px solid var(--neutral-100)" }}>
                <Avatar name={OWNERS[v.owner]?.name || "User"} size={20} />
                <span style={{ fontSize: 12, color: "var(--neutral-600)" }}>{OWNERS[v.owner]?.name.split(" ")[0]}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: "var(--neutral-500)" }}>Ran {v.lastRun}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Digest page ──────────────────────────────────────────────────
const DigestPage = () => {
  const [showSlackPreview, setShowSlackPreview] = useStatePg(true);
  const subscriptions = [
    { id: 1, conceptId: "revenue.total_vnd",  cadence: "weekly Monday 09:00", channel: "slack", changeOnly: false },
    { id: 2, conceptId: "users.dau",          cadence: "daily 09:00", channel: "slack + email", changeOnly: false },
    { id: 3, conceptId: "retention.dn",       cadence: "on change only", channel: "slack", changeOnly: true },
    { id: 4, conceptId: "payments.refund_rate", cadence: "on change only", channel: "slack", changeOnly: true },
    { id: 5, conceptId: "users.new_payers",   cadence: "weekly Monday 09:00", channel: "email", changeOnly: false },
  ];

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 28px" }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 22, color: "var(--neutral-950)", letterSpacing: "-0.02em" }}>Digest</h1>
        <div style={{ fontSize: 13, color: "var(--neutral-600)", marginTop: 4 }}>Metrics you subscribe to are delivered to Slack & email on your chosen cadence. Default is <i>on-change-only</i> to reduce fatigue.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20, alignItems: "flex-start" }}>
        {/* Left — subscription manager */}
        <div>
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 14, color: "var(--neutral-950)" }}>Subscriptions</span>
              <Badge variant="secondary" leftIcon="bell">{subscriptions.length} active</Badge>
              <div style={{ flex: 1 }} />
              <Button variant="outline" size="sm" leftIcon="plus">Subscribe to a metric</Button>
            </div>
            {subscriptions.map(sub => {
              const c = CONCEPT_BY_ID[sub.conceptId];
              if (!c) return null;
              return (
                <div key={sub.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--neutral-100)" }}>
                  <TypeIcon type={c.type} size={12} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 13, color: "var(--neutral-950)" }}>{c.label}</span>
                      {c.anomaly !== "none" && c.anomaly && <AnomalyBadge state={c.anomaly} delta={c.deltaPct} />}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--neutral-600)", marginTop: 2 }}>{sub.cadence} · <Icon name={sub.channel.includes("slack") ? "slack" : "mail"} size={11} style={{ verticalAlign: "middle" }} /> {sub.channel}</div>
                  </div>
                  <Sparkline data={c.spark || [1,1,1]} width={80} height={24} color="var(--neutral-700)" lastPointDot />
                  <Metric value={typeof c.current === "number" ? formatN(c.current) : c.current} size="sm" delta={c.deltaPct} deltaPositive={c.deltaPct > 0} />
                  <Tooltip content="Snooze 1 week"><Button variant="ghost" size="iconSm"><Icon name="bell-off" size={13} /></Button></Tooltip>
                  <Tooltip content="Settings"><Button variant="ghost" size="iconSm"><Icon name="settings" size={13} /></Button></Tooltip>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 18, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 14, color: "var(--neutral-950)", marginBottom: 12 }}>Defaults</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <PrefRow label="Default cadence" value="On change only" hint="Per Tableau Pulse 2024: low-frequency wins." />
              <PrefRow label="Anomaly threshold" value="2σ from rolling 14-day mean" />
              <PrefRow label="Quiet hours" value="22:00 – 07:00 (UTC+7)" />
              <PrefRow label="Slack channel" value="#data-pulse" />
            </div>
          </div>
        </div>

        {/* Right — preview */}
        <aside style={{ position: "sticky", top: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Preview</span>
            <div style={{ display: "flex", padding: 2, background: "var(--neutral-100)", borderRadius: 8 }}>
              <span onClick={() => setShowSlackPreview(true)} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer", background: showSlackPreview ? "#fff" : "transparent", color: "var(--neutral-900)" }}>Slack</span>
              <span onClick={() => setShowSlackPreview(false)} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer", background: !showSlackPreview ? "#fff" : "transparent", color: "var(--neutral-900)" }}>Email</span>
            </div>
          </div>
          {showSlackPreview ? <SlackDigestPreview /> : <EmailDigestPreview />}
        </aside>
      </div>
    </div>
  );
};

const PrefRow = ({ label, value, hint }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--neutral-900)" }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--neutral-500)", marginTop: 1 }}>{hint}</div>}
    </div>
    <span style={{ padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--neutral-700)", background: "#fff", display: "inline-flex", alignItems: "center", gap: 6 }}>{value} <Icon name="chevron-down" size={11} color="var(--neutral-400)" /></span>
  </div>
);

const SlackDigestPreview = () => (
  <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 14, fontFamily: "var(--font-sans)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ width: 32, height: 32, borderRadius: 6, background: "var(--neutral-950)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 14 }}>C</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--neutral-950)" }}>Compass <span style={{ fontSize: 10, color: "var(--neutral-500)", padding: "1px 5px", border: "1px solid var(--border)", borderRadius: 4, marginLeft: 4 }}>APP</span></div>
        <div style={{ fontSize: 11, color: "var(--neutral-500)" }}>Today at 09:00</div>
      </div>
    </div>
    <div style={{ fontSize: 13, color: "var(--neutral-900)", marginBottom: 10, lineHeight: 1.5 }}>
      Morning Khoi 👋 Here's what moved overnight:
    </div>
    <SlackBlock>
      <SlackHeader concept={CONCEPT_BY_ID["payments.refund_rate"]} anomaly />
      <div style={{ fontSize: 12, color: "var(--neutral-700)", lineHeight: 1.55, marginTop: 6 }}>
        Refund Rate hit <b>2.8%</b> — <b style={{ color: "var(--destructive)" }}>+154%</b> vs 14-day avg. The spike concentrates in <b>VN · facebook_ads</b> · <b>whales</b>.
      </div>
      <SlackButtons />
    </SlackBlock>
    <SlackBlock>
      <SlackHeader concept={CONCEPT_BY_ID["revenue.total_vnd"]} />
      <div style={{ fontSize: 12, color: "var(--neutral-700)", lineHeight: 1.55, marginTop: 6 }}>
        Revenue <b>581.2M VND</b> · <b style={{ color: "var(--success)" }}>+4.2%</b> WoW. IAP in VN drove most of the lift.
      </div>
      <SlackButtons />
    </SlackBlock>
    <SlackBlock>
      <SlackHeader concept={CONCEPT_BY_ID["retention.dn"]} />
      <div style={{ fontSize: 12, color: "var(--neutral-700)", lineHeight: 1.55, marginTop: 6 }}>
        D7 Retention <b>41.2%</b> · <b style={{ color: "var(--destructive)" }}>−2.4%</b> WoW. Worth checking.
      </div>
      <SlackButtons />
    </SlackBlock>
  </div>
);

const SlackBlock = ({ children }) => (
  <div style={{ borderLeft: "3px solid var(--neutral-200)", paddingLeft: 10, marginBottom: 12, paddingBottom: 8 }}>{children}</div>
);
const SlackHeader = ({ concept, anomaly }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <Sparkline data={concept?.spark || [1,1,1]} width={36} height={14} color={anomaly ? "var(--destructive)" : "var(--neutral-700)"} />
    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--neutral-950)" }}>{concept?.label || "—"}</span>
    {anomaly && <AnomalyBadge state="high" />}
    <span style={{ flex: 1 }} />
    <TrustBadge state={concept?.trust || "certified"} prominent="quiet" />
  </div>
);
const SlackButtons = () => (
  <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
    <span style={{ padding: "3px 9px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 11, fontWeight: 600, color: "var(--neutral-800)", background: "#fff", cursor: "pointer" }}>Open in catalog</span>
    <span style={{ padding: "3px 9px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 11, fontWeight: 600, color: "var(--neutral-800)", background: "#fff", cursor: "pointer" }}>Why?</span>
    <span style={{ padding: "3px 9px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 11, fontWeight: 600, color: "var(--neutral-800)", background: "#fff", cursor: "pointer" }}>Mute</span>
  </div>
);

const EmailDigestPreview = () => (
  <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 0, overflow: "hidden", fontFamily: "var(--font-sans)" }}>
    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", background: "var(--neutral-50)", display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 32, height: 32, borderRadius: 6, background: "var(--neutral-950)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 14 }}>C</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--neutral-950)" }}>Your Compass digest · Monday</div>
        <div style={{ fontSize: 11, color: "var(--neutral-500)" }}>compass@vng.games · to khoi.tn@vng.com.vn</div>
      </div>
    </div>
    <div style={{ padding: "18px 20px" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--neutral-950)", marginBottom: 6 }}>3 metrics moved this week</div>
      <div style={{ fontSize: 12, color: "var(--neutral-600)", marginBottom: 14 }}>Compass watched 5 subscribed metrics. Here's what changed.</div>
      {["payments.refund_rate", "revenue.total_vnd", "retention.dn"].map(id => {
        const c = CONCEPT_BY_ID[id];
        return (
          <div key={id} style={{ padding: "12px 0", borderTop: "1px solid var(--neutral-100)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--neutral-950)", flex: 1 }}>{c.label}</span>
              <Metric value={formatN(c.current)} size="sm" delta={c.deltaPct} deltaPositive={c.deltaPct > 0} />
            </div>
            <Sparkline data={c.spark} width={300} height={26} color="var(--neutral-700)" fillBg="rgba(10,10,10,0.04)" />
          </div>
        );
      })}
    </div>
  </div>
);

// ─── Notifications page ────────────────────────────────────────────
const NotificationsPage = ({ openChangeAnalysis }) => {
  const { go } = useNav();
  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "24px 28px" }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 22, color: "var(--neutral-950)", letterSpacing: "-0.02em" }}>Notifications</h1>
        <div style={{ fontSize: 13, color: "var(--neutral-600)", marginTop: 4 }}>Anomaly alerts, mentions, and changes to concepts you watch.</div>
      </div>
      <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        {NOTIFICATIONS.map(n => {
          const c = n.concept ? CONCEPT_BY_ID[n.concept] : null;
          return (
            <div key={n.id} onClick={() => { if (n.type === "anomaly") openChangeAnalysis(n.concept); else if (c) go({ name: "metric", id: n.concept }); }} style={{
              display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 18px", borderBottom: "1px solid var(--neutral-100)", cursor: "pointer",
            }} onMouseEnter={e => e.currentTarget.style.background = "var(--neutral-50)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={{ width: 34, height: 34, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                background: n.type === "anomaly" ? "var(--anomaly-high-bg)" : n.type === "feedback" ? "#dbeafe" : n.type === "edit" ? "var(--neutral-100)" : "var(--orange-50)",
                color: n.type === "anomaly" ? "var(--anomaly-high)" : n.type === "feedback" ? "var(--blue-700)" : "var(--neutral-700)",
              }}>
                <Icon name={n.type === "anomaly" ? "alert-triangle" : n.type === "feedback" ? "message-square" : n.type === "edit" ? "pencil-line" : n.type === "digest" ? "mail" : "bell"} size={15} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--neutral-950)" }}>{n.title}</div>
                {c && <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <TypeIcon type={c.type} size={10} />
                  <span style={{ fontSize: 11, color: "var(--neutral-500)", fontFamily: "var(--font-mono)" }}>{c.cube}.{c.member}</span>
                </div>}
              </div>
              {n.state && <AnomalyBadge state={n.state} delta={c?.deltaPct} />}
              <span style={{ fontSize: 11, color: "var(--neutral-500)", whiteSpace: "nowrap", marginLeft: 8 }}>{n.ts}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Workspaces (P3, light shell) ──────────────────────────────────
const WorkspacesPage = () => {
  const ws = [
    { id: 1, name: "VN Ops weekly", owner: "minh", description: "Lapsed payers, whale revenue, refund rate.", metrics: ["revenue.total_vnd", "payments.refund_rate", "seg.lapsed_payer_14d"], shared: "team" },
    { id: 2, name: "Exec MTD", owner: "hieu", description: "Revenue MTD, ARPPU, paying users.", metrics: ["revenue.total_vnd", "revenue.arppu_vnd", "users.paying_users"], shared: "org" },
    { id: 3, name: "UA dashboard", owner: "tuan", description: "Installs, CPI, ROAS D7.", metrics: ["acquisition.installs", "marketing.cpi_vnd", "marketing.roas_d7"], shared: "team" },
  ];
  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 22, color: "var(--neutral-950)", letterSpacing: "-0.02em" }}>Workspaces</h1>
          <div style={{ fontSize: 13, color: "var(--neutral-600)", marginTop: 4 }}>Curated collections — multiple saved views, charts, and commentary in one canvas.</div>
        </div>
        <Button variant="primary" size="sm" leftIcon="plus">New workspace</Button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
        {ws.map(w => (
          <Card key={w.id} hover padding={20} asLink>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ width: 36, height: 36, borderRadius: 8, background: "var(--neutral-950)", color: "var(--orange-400)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="layout-grid" size={16} />
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 14, color: "var(--neutral-950)" }}>{w.name}</div>
                <div style={{ fontSize: 11, color: "var(--neutral-500)" }}>by {OWNERS[w.owner]?.name} · shared with {w.shared}</div>
              </div>
              <Badge variant={w.shared === "org" ? "info" : "secondary"} leftIcon={w.shared === "org" ? "globe" : "users"}>{w.shared}</Badge>
            </div>
            <div style={{ fontSize: 13, color: "var(--neutral-600)", marginBottom: 12, lineHeight: 1.5 }}>{w.description}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {w.metrics.map(id => { const c = CONCEPT_BY_ID[id]; return c && <Badge key={id} variant="outline" leftIcon={c.type === "measure" ? "sigma" : c.type === "segment" ? "filter" : "rows-3"}>{c.label}</Badge>; })}
            </div>
          </Card>
        ))}

        {/* Empty state card */}
        <div style={{ padding: 20, border: "1px dashed var(--neutral-300)", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--neutral-500)", minHeight: 200, cursor: "pointer" }}>
          <Icon name="plus" size={18} />
          <div style={{ fontSize: 13, fontWeight: 500 }}>Create your first workspace</div>
          <div style={{ fontSize: 11, textAlign: "center", maxWidth: 240 }}>Pin metrics, add commentary, and share a permanent URL.</div>
        </div>
      </div>
    </div>
  );
};

// ─── Modals ────────────────────────────────────────────────────────
const SubscribeModal = ({ open, onClose, concept }) => {
  const [cadence, setCadence] = useStatePg("change");
  const [channels, setChannels] = useStatePg({ slack: true, email: false });
  const toast = useToast();
  if (!concept) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Subscribe to ${concept.label}`} subtitle="Pick when and where to be notified." width={520}
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button variant="primary" size="sm" leftIcon="check" onClick={() => { onClose(); toast?.(`Subscribed to ${concept.label}`, { icon: "bell" }); }}>Subscribe</Button></>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <Label2>Cadence</Label2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { v: "change",  label: "On change only",  desc: "Alert when this metric moves >2σ. Recommended.", icon: "alert-triangle" },
              { v: "daily",   label: "Daily 09:00",     desc: "A line in the Monday-Friday digest.", icon: "calendar-clock" },
              { v: "weekly",  label: "Weekly Monday",   desc: "A roll-up in the weekly digest.", icon: "calendar-days" },
            ].map(c => (
              <label key={c.v} style={{ display: "flex", gap: 10, padding: "10px 12px", border: `1.5px solid ${cadence === c.v ? "var(--neutral-950)" : "var(--border)"}`, borderRadius: 8, cursor: "pointer", background: cadence === c.v ? "var(--neutral-50)" : "#fff" }}>
                <input type="radio" name="cadence" checked={cadence === c.v} onChange={() => setCadence(c.v)} style={{ marginTop: 3 }} />
                <Icon name={c.icon} size={14} color="var(--neutral-600)" style={{ marginTop: 3 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--neutral-950)" }}>{c.label}</div>
                  <div style={{ fontSize: 12, color: "var(--neutral-500)", marginTop: 2 }}>{c.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label2>Deliver to</Label2>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, padding: "10px 12px", border: `1.5px solid ${channels.slack ? "var(--neutral-950)" : "var(--border)"}`, borderRadius: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={channels.slack} onChange={e => setChannels(c => ({...c, slack: e.target.checked}))} />
              <Icon name="slack" size={14} color="var(--neutral-700)" />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Slack</span>
              <span style={{ fontSize: 11, color: "var(--neutral-500)", marginLeft: "auto" }}>#data-pulse</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, padding: "10px 12px", border: `1.5px solid ${channels.email ? "var(--neutral-950)" : "var(--border)"}`, borderRadius: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={channels.email} onChange={e => setChannels(c => ({...c, email: e.target.checked}))} />
              <Icon name="mail" size={14} color="var(--neutral-700)" />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Email</span>
            </label>
          </div>
        </div>
      </div>
    </Modal>
  );
};

const SaveViewModal = ({ open, onClose }) => {
  const [name, setName] = useStatePg("VN whales — revenue WoW");
  const [share, setShare] = useStatePg("private");
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title="Save view" subtitle="Captures your chip sequence, filters, and chart type." width={460}
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button variant="primary" size="sm" leftIcon="bookmark" onClick={() => { onClose(); toast?.("View saved", { icon: "check" }); }}>Save</Button></>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <Label2>Name</Label2>
          <Input value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <Label2>Share with</Label2>
          <div style={{ display: "flex", gap: 6 }}>
            {["private", "team", "org"].map(s => (
              <span key={s} onClick={() => setShare(s)} style={{ flex: 1, textAlign: "center", padding: "8px 10px", border: `1.5px solid ${share === s ? "var(--neutral-950)" : "var(--border)"}`, borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, color: "var(--neutral-900)", background: share === s ? "var(--neutral-50)" : "#fff" }}>
                <Icon name={s === "private" ? "lock" : s === "team" ? "users" : "globe"} size={12} style={{ marginRight: 6 }} />
                {s[0].toUpperCase() + s.slice(1)}
              </span>
            ))}
          </div>
        </div>
        <div style={{ padding: 12, background: "var(--neutral-50)", borderRadius: 8, fontSize: 12, color: "var(--neutral-600)", display: "flex", alignItems: "flex-start", gap: 8 }}>
          <Icon name="info" size={12} style={{ marginTop: 2 }} />
          <span>Saved views are re-runnable. Parameters (date range, segment values) stay editable on re-run.</span>
        </div>
      </div>
    </Modal>
  );
};

const ChangeAnalysisModal = ({ open, onClose, conceptId = "revenue.total_vnd" }) => {
  const data = CHANGE_ANALYSIS[conceptId];
  const c = CONCEPT_BY_ID[conceptId];
  const [activeDim, setActiveDim] = useStatePg(0);
  if (!data) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Why did ${c?.label} move?`} subtitle="Decomposition by available dimensions, sorted by contribution magnitude." width={780}
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Close</Button><Button variant="outline" size="sm" leftIcon="compass">Open in Explore</Button><Button variant="primary" size="sm" leftIcon="bookmark">Save as view</Button></>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Headline */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: 14, background: "var(--anomaly-high-bg)", border: "1px solid #fecaca", borderRadius: 10 }}>
          <AnomalyBadge state="high" delta={data.delta} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 16, color: "var(--neutral-950)" }}>{data.headline}</div>
            <div style={{ fontSize: 12, color: "var(--neutral-600)", marginTop: 2 }}>Confidence <b>{Math.round(data.confidence * 100)}%</b> · 14-day baseline · 2σ threshold</div>
          </div>
        </div>

        {/* Suspected cause */}
        <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 10, background: "#fff", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ width: 28, height: 28, borderRadius: 6, background: "var(--neutral-950)", color: "var(--orange-400)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="sparkles" size={14} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Most likely cause</div>
            <div style={{ fontSize: 14, color: "var(--neutral-950)", marginTop: 4, lineHeight: 1.5 }}>
              <b>{data.suspectedCause.dim} = {data.suspectedCause.value}</b>. {data.suspectedCause.reason}
            </div>
          </div>
        </div>

        {/* Dimension tabs */}
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {data.breakdowns.map((b, i) => (
              <span key={b.dim} onClick={() => setActiveDim(i)} style={{ padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", background: activeDim === i ? "var(--neutral-100)" : "transparent", color: activeDim === i ? "var(--neutral-950)" : "var(--neutral-600)" }}>By {b.dim}</span>
            ))}
          </div>
          <DecompositionTable breakdown={data.breakdowns[activeDim]} />
        </div>
      </div>
    </Modal>
  );
};

const DecompositionTable = ({ breakdown }) => {
  const max = Math.max(...breakdown.rows.map(r => Math.abs(r.contribution)));
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "var(--neutral-50)" }}>
            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{breakdown.dim}</th>
            <th style={{ textAlign: "right", padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Current</th>
            <th style={{ textAlign: "right", padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Prev</th>
            <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em", width: 240 }}>Contribution</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {breakdown.rows.map(r => {
            const pos = r.contribution > 0;
            return (
              <tr key={r.value} style={{ borderTop: "1px solid var(--neutral-100)" }}>
                <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 500, color: "var(--neutral-950)" }}>{r.value}</td>
                <td style={{ padding: "10px 12px", fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--neutral-900)", textAlign: "right" }}>{formatN(r.current)}</td>
                <td style={{ padding: "10px 12px", fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--neutral-500)", textAlign: "right" }}>{formatN(r.prev)}</td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ position: "relative", height: 14, background: "var(--neutral-100)", borderRadius: 3 }}>
                    <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--neutral-300)" }} />
                    <div style={{ position: "absolute", left: pos ? "50%" : `${50 - (Math.abs(r.contribution) / max) * 50}%`, top: 0, bottom: 0, width: `${(Math.abs(r.contribution) / max) * 50}%`, background: pos ? "var(--success)" : "var(--destructive)", borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: pos ? "var(--success)" : "var(--destructive)", marginTop: 2, display: "inline-block" }}>{pos ? "+" : ""}{r.contribution}%</span>
                </td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>
                  <Tooltip content="Drill into this slice"><Button variant="ghost" size="iconSm"><Icon name="arrow-up-right" size={12} /></Button></Tooltip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const Label2 = ({ children }) => <div style={{ fontSize: 11, fontWeight: 600, color: "var(--neutral-700)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{children}</div>;

const formatN = (v) => {
  if (typeof v !== "number") return v;
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + "B";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toLocaleString();
};

Object.assign(window, { SavedViewsPage, DigestPage, NotificationsPage, WorkspacesPage, SubscribeModal, SaveViewModal, ChangeAnalysisModal });
