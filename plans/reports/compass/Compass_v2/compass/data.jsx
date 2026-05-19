/* global window */
/* Compass seed data — revised for the two-layer model (PRD §1.1).
   ---------------------------------------------------------------------------
   • METRICS         — Metric layer (consumer). 21 Tier 1–3 metrics drawn from
                       `metric-mapping-260519-poc-gds-vs-cubes.md`. Each composes
                       *other metrics* and/or *building blocks*.
   • CONCEPTS        — Data Model layer (author/power-user). Measures, dimensions
                       and segments exposed by /cubejs-api/v1/meta across the
                       4 real cubes: mf_users · active_daily · user_recharge_daily · recharge.
   • CATALOG_BY_ID   — Unified lookup across both layers (so existing detail-page
                       code can resolve any id without caring which layer it is).
   ---------------------------------------------------------------------------
*/

// ───────────────────────── Owners ─────────────────────────
const OWNERS = {
  khoi:  { id: "khoi",  name: "Khoi Tran",  team: "Data Platform" },
  linh:  { id: "linh",  name: "Linh Pham",  team: "Game Analytics" },
  minh:  { id: "minh",  name: "Minh Vo",    team: "Liveops" },
  tuan:  { id: "tuan",  name: "Tuan Le",    team: "Growth" },
  ngan:  { id: "ngan",  name: "Ngan Nguyen",team: "Data Platform" },
  hieu:  { id: "hieu",  name: "Hieu Dang",  team: "Finance" },
};

// ───────────────────────── Tier taxonomy (PRD §5.2.A) ─────────────────────────
const TIER_INFO = {
  1: { label: "Tier 1", shortLabel: "T1", description: "Existing measure, single cube", color: "var(--tier-1)",  bg: "var(--tier-1-bg)",  status: "ready" },
  2: { label: "Tier 2", shortLabel: "T2", description: "Measure + time grain or simple segment", color: "var(--tier-2)",  bg: "var(--tier-2-bg)",  status: "ready" },
  3: { label: "Tier 3", shortLabel: "T3", description: "Cohort filter on mf_users anchors", color: "var(--tier-3)",  bg: "var(--tier-3-bg)",  status: "ready" },
  4: { label: "Tier 4", shortLabel: "T4", description: "Cohort + day-N offset — query-template work", color: "var(--tier-4)",  bg: "var(--tier-4-bg)",  status: "blocked" },
  5: { label: "Tier 5", shortLabel: "T5", description: "Schema gap — needs new YAML / roles cube", color: "var(--tier-5)",  bg: "var(--tier-5-bg)",  status: "blocked" },
  6: { label: "Tier 6", shortLabel: "T6", description: "Ingestion gap — needs new data source (Marketing / CCU / Funnel)", color: "var(--tier-6)",  bg: "var(--tier-6-bg)",  status: "blocked" },
};

// ───────────────────────── Sparkline helper ─────────────────────────
const _spark = (base, vol = 0.1, len = 14) => {
  const out = []; let v = base;
  for (let i = 0; i < len; i++) {
    v = v + (Math.sin(i * 0.7) * vol * base * 0.3) + (Math.cos(i * 1.3) * vol * base * 0.2);
    out.push(Math.max(0, Math.round(v * 100) / 100));
  }
  return out;
};

// ═══════════════════════════════════════════════════════════════════════════
//  DATA MODEL LAYER  —  building blocks (cube measures/dims/segments)
//  Sourced from the 4 published cubes per `metric-mapping…poc-gds-vs-cubes.md`.
// ═══════════════════════════════════════════════════════════════════════════
const CONCEPTS = [
  // ─────── Cube: active_daily ───────  (1 row / user / active day)
  {
    id: "bb.active_daily.dau", type: "measure", cube: "active_daily", member: "dau",
    label: "DAU (approx)",
    description: "Distinct active user_id per log_date. HLL approximate count (~1.6% error). The default fast aggregate for engagement queries.",
    formulaText: "`count_distinct_approx(active_daily.user_id)`",
    unit: "users", domain: "engagement", trust: "certified",
    synonyms: ["dau", "daily active", "active users"],
    owner: "linh", refreshMinutes: 6, refreshSla: 30, certifiedAt: "2026-03-01",
    usedIn: { dashboards: 22, mcp: 5, cdp: 11, savedViews: 47 },
    spark: _spark(124_000, 0.05), current: 124_580, deltaPct: 2.1, anomaly: "none",
  },
  {
    id: "bb.active_daily.dau_exact", type: "measure", cube: "active_daily", member: "dau_exact",
    label: "DAU (exact)",
    description: "Exact distinct active user_id per log_date. Slower than `dau`. Reserved for finance/audit reporting.",
    formulaText: "`count_distinct(active_daily.user_id)`",
    unit: "users", domain: "engagement", trust: "certified",
    synonyms: ["exact dau", "audit dau"],
    owner: "linh", refreshMinutes: 18, refreshSla: 60,
    usedIn: { dashboards: 3, mcp: 0, cdp: 0, savedViews: 4 },
    spark: _spark(125_000, 0.05), current: 125_120, deltaPct: 2.0, anomaly: "none",
  },
  {
    id: "bb.active_daily.mau", type: "measure", cube: "active_daily", member: "mau",
    label: "MAU rollup",
    description: "Distinct user_id over a rolling 30-day window. Use with granularity=month for calendar MAU.",
    formulaText: "`count_distinct_approx(active_daily.user_id)` over rolling 30d",
    unit: "users", domain: "engagement", trust: "certified",
    owner: "linh", refreshMinutes: 18, refreshSla: 60,
    usedIn: { dashboards: 12, mcp: 1, cdp: 3, savedViews: 18 },
    spark: _spark(640_000, 0.03), current: 638_900, deltaPct: 1.2, anomaly: "none",
  },
  { id: "bb.active_daily.log_date", type: "dimension", cube: "active_daily", member: "log_date", label: "Log date", description: "Calendar day a user was observed active (UTC+7).", unit: "date", domain: "custom", trust: "certified", owner: "khoi", refreshMinutes: 6, refreshSla: 30, usedIn: { dashboards: 999, mcp: 0, cdp: 0, savedViews: 999 } },
  { id: "bb.active_daily.user_id", type: "dimension", cube: "active_daily", member: "user_id", label: "User ID (active)", description: "Hashed user_id key. Joins to mf_users.user_id.", unit: "string", domain: "custom", trust: "certified", owner: "khoi", refreshMinutes: 6, refreshSla: 30, usedIn: { dashboards: 30, mcp: 5, cdp: 18, savedViews: 50 } },
  { id: "bb.active_daily.country", type: "dimension", cube: "active_daily", member: "country", label: "Country (active)", description: "ISO-2 country code at session time.", unit: "string", domain: "acquisition", trust: "certified", owner: "ngan", refreshMinutes: 6, refreshSla: 30, usedIn: { dashboards: 18, mcp: 4, cdp: 12, savedViews: 38 }, examples: ["VN", "TH", "ID", "PH", "MY"] },
  { id: "bb.active_daily.platform", type: "dimension", cube: "active_daily", member: "platform", label: "Platform (active)", description: "iOS / Android / Web at session time.", unit: "string", domain: "acquisition", trust: "certified", owner: "ngan", refreshMinutes: 6, refreshSla: 30, usedIn: { dashboards: 24, mcp: 1, cdp: 10, savedViews: 30 }, examples: ["ios", "android", "web"] },

  // ─────── Cube: user_recharge_daily ───────  (1 row / user / recharge day)
  {
    id: "bb.user_recharge_daily.paying_users", type: "measure", cube: "user_recharge_daily", member: "paying_users",
    label: "Paying users (approx)",
    description: "Distinct paying user_id per log_date. HLL approximate count.",
    formulaText: "`count_distinct_approx(user_recharge_daily.user_id)`",
    unit: "users", domain: "revenue", trust: "certified",
    synonyms: ["pu", "payers", "paid users"],
    owner: "linh", refreshMinutes: 9, refreshSla: 60,
    usedIn: { dashboards: 18, mcp: 4, cdp: 9, savedViews: 26 },
    spark: _spark(8_400, 0.06), current: 8_720, deltaPct: 1.4, anomaly: "none",
  },
  {
    id: "bb.user_recharge_daily.paying_users_exact", type: "measure", cube: "user_recharge_daily", member: "paying_users_exact",
    label: "Paying users (exact)", description: "Exact distinct paying user_id per log_date. Use for finance reports.",
    formulaText: "`count_distinct(user_recharge_daily.user_id)`",
    unit: "users", domain: "revenue", trust: "certified",
    owner: "linh", refreshMinutes: 14, refreshSla: 60,
    usedIn: { dashboards: 2, mcp: 0, cdp: 0, savedViews: 3 },
  },
  {
    id: "bb.user_recharge_daily.revenue_vnd_total", type: "measure", cube: "user_recharge_daily", member: "revenue_vnd_total",
    label: "Revenue VND (daily rollup)",
    description: "Pre-rolled per user/day revenue. Faster than `recharge.revenue_vnd` for day/week/month aggregates.",
    formulaText: "`SUM(user_recharge_daily.revenue_vnd_total)`",
    unit: "VND", domain: "revenue", trust: "certified",
    synonyms: ["revenue rollup", "daily revenue"],
    owner: "linh", refreshMinutes: 8, refreshSla: 60,
    usedIn: { dashboards: 14, mcp: 3, cdp: 7, savedViews: 31 },
    spark: _spark(540_000_000, 0.08), current: 581_240_000, deltaPct: 4.2, anomaly: "none",
  },
  { id: "bb.user_recharge_daily.log_date", type: "dimension", cube: "user_recharge_daily", member: "log_date", label: "Log date (paying)", description: "Calendar day of recharge (UTC+7).", unit: "date", domain: "custom", trust: "certified", owner: "khoi", refreshMinutes: 8, refreshSla: 60, usedIn: { dashboards: 99, mcp: 0, cdp: 0, savedViews: 99 } },

  // ─────── Cube: recharge ───────  (1 row / transaction)
  {
    id: "bb.recharge.transactions", type: "measure", cube: "recharge", member: "transactions",
    label: "Transactions",
    description: "Total number of successful payment transactions in the period.",
    formulaText: "`COUNT(*)` over recharge",
    unit: "count", domain: "payments", trust: "certified",
    synonyms: ["txns", "purchases", "orders"],
    owner: "ngan", refreshMinutes: 4, refreshSla: 30,
    usedIn: { dashboards: 4, mcp: 0, cdp: 0, savedViews: 7 },
    spark: _spark(11_200, 0.05), current: 11_540, deltaPct: 1.6, anomaly: "none",
  },
  {
    id: "bb.recharge.revenue_vnd", type: "measure", cube: "recharge", member: "revenue_vnd",
    label: "Revenue VND (transactional)",
    description: "Per-transaction revenue. Use when joining to attributes that live on `recharge` rows (e.g. payment_method).",
    formulaText: "`SUM(recharge.amount_vnd)`",
    unit: "VND", domain: "revenue", trust: "certified",
    owner: "linh", refreshMinutes: 6, refreshSla: 60,
    usedIn: { dashboards: 8, mcp: 1, cdp: 2, savedViews: 12 },
    spark: _spark(560_000_000, 0.09), current: 583_400_000, deltaPct: 4.0, anomaly: "none",
  },
  {
    id: "bb.recharge.arppu_vnd", type: "measure", cube: "recharge", member: "arppu_vnd",
    label: "ARPPU VND (period, calculated)",
    description: "Period ARPPU = revenue / distinct paying users, computed inside the cube.",
    formulaText: "`SUM(amount_vnd) / count_distinct_approx(user_id)`",
    unit: "VND", domain: "revenue", trust: "certified",
    owner: "linh", refreshMinutes: 14, refreshSla: 60,
    usedIn: { dashboards: 7, mcp: 1, cdp: 0, savedViews: 11 },
    spark: _spark(64_000, 0.04), current: 65_980, deltaPct: 1.2, anomaly: "none",
  },
  { id: "bb.recharge.recharge_date", type: "dimension", cube: "recharge", member: "recharge_date", label: "Recharge date", description: "Date of the transaction (UTC+7). Assumed equal to delivery date for POC.", unit: "date", domain: "custom", trust: "certified", owner: "khoi", refreshMinutes: 4, refreshSla: 30, usedIn: { dashboards: 22, mcp: 0, cdp: 0, savedViews: 30 } },
  { id: "bb.recharge.payment_method", type: "dimension", cube: "recharge", member: "payment_method", label: "Payment method", description: "Zing Card / Momo / Card / IAP / Bank.", unit: "string", domain: "payments", trust: "certified", owner: "ngan", refreshMinutes: 4, refreshSla: 30, usedIn: { dashboards: 6, mcp: 0, cdp: 1, savedViews: 5 }, examples: ["zing_card", "momo", "iap_ios", "iap_android", "bank"] },
  { id: "bb.recharge.role_id", type: "dimension", cube: "recharge", member: "role_id", label: "Role ID (recharge)", description: "Game character/role making the purchase. Not yet hub-joined — defer role-grain metrics.", unit: "string", domain: "custom", trust: "beta", owner: "khoi", refreshMinutes: 4, refreshSla: 30, usedIn: { dashboards: 1, mcp: 0, cdp: 0, savedViews: 0 } },

  // ─────── Cube: mf_users ───────  (1 row / user · the hub)
  {
    id: "bb.mf_users.user_count_approx", type: "measure", cube: "mf_users", member: "user_count_approx",
    label: "User count (approx)",
    description: "HLL distinct user_id. The base measure all `NRU/NPU/NNPU` cohort metrics filter on.",
    formulaText: "`count_distinct_approx(mf_users.user_id)`",
    unit: "users", domain: "acquisition", trust: "certified",
    synonyms: ["user count", "users", "n users"],
    owner: "khoi", refreshMinutes: 30, refreshSla: 60,
    usedIn: { dashboards: 9, mcp: 2, cdp: 6, savedViews: 14 },
    spark: _spark(2_400_000, 0.01), current: 2_412_300, deltaPct: 0.3, anomaly: "none",
  },
  {
    id: "bb.mf_users.user_count", type: "measure", cube: "mf_users", member: "user_count",
    label: "User count (exact)",
    description: "Exact distinct user_id. Used by finance for audit-grade reports.",
    formulaText: "`count_distinct(mf_users.user_id)`",
    unit: "users", domain: "acquisition", trust: "certified",
    owner: "khoi", refreshMinutes: 60, refreshSla: 120,
    usedIn: { dashboards: 2, mcp: 0, cdp: 0, savedViews: 2 },
  },
  {
    id: "bb.mf_users.arpu_vnd", type: "measure", cube: "mf_users", member: "arpu_vnd",
    label: "ARPU VND (lifetime)",
    description: "Per-user lifetime revenue average. Hub-grain — does not respect any time-window filter.",
    formulaText: "`AVG(mf_users.lifetime_revenue_vnd)`",
    unit: "VND", domain: "revenue", trust: "certified",
    owner: "linh", refreshMinutes: 30, refreshSla: 120,
    usedIn: { dashboards: 6, mcp: 0, cdp: 0, savedViews: 9 },
  },
  {
    id: "bb.mf_users.arppu_vnd", type: "measure", cube: "mf_users", member: "arppu_vnd",
    label: "ARPPU VND (lifetime)",
    description: "Per-paying-user lifetime revenue average.",
    formulaText: "`AVG(mf_users.lifetime_revenue_vnd) WHERE lifetime_revenue_vnd > 0`",
    unit: "VND", domain: "revenue", trust: "certified",
    owner: "linh", refreshMinutes: 30, refreshSla: 120,
    usedIn: { dashboards: 5, mcp: 0, cdp: 0, savedViews: 6 },
  },
  {
    id: "bb.mf_users.paying_rate", type: "measure", cube: "mf_users", member: "paying_rate",
    label: "Paying rate (lifetime)",
    description: "Lifetime payers / lifetime users. Hub-grain, does not respect window filters.",
    formulaText: "`mf_users.lifetime_paying_users / mf_users.user_count`",
    unit: "%", domain: "revenue", trust: "certified",
    owner: "linh", refreshMinutes: 30, refreshSla: 120,
    usedIn: { dashboards: 4, mcp: 0, cdp: 0, savedViews: 6 },
  },
  {
    id: "bb.mf_users.paying_rate_30d", type: "measure", cube: "mf_users", member: "paying_rate_30d",
    label: "Paying rate (rolling 30d)",
    description: "Pre-aggregated payers-in-last-30d / actives-in-last-30d.",
    formulaText: "`mf_users.paying_users_30d / mf_users.active_users_30d`",
    unit: "%", domain: "revenue", trust: "certified",
    owner: "linh", refreshMinutes: 30, refreshSla: 120,
    usedIn: { dashboards: 3, mcp: 0, cdp: 0, savedViews: 5 },
  },
  { id: "bb.mf_users.user_id", type: "dimension", cube: "mf_users", member: "user_id", label: "User ID (hub)", description: "Primary key. All hub-and-spoke joins land here.", unit: "string", domain: "custom", trust: "certified", owner: "khoi", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 999, mcp: 0, cdp: 0, savedViews: 999 } },
  { id: "bb.mf_users.first_active_date", type: "dimension", cube: "mf_users", member: "first_active_date", label: "First active date", description: "First date the user was observed active (register/login/logout/payment).", unit: "date", domain: "acquisition", trust: "certified", owner: "khoi", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 14, mcp: 1, cdp: 4, savedViews: 22 } },
  { id: "bb.mf_users.first_recharge_date", type: "dimension", cube: "mf_users", member: "first_recharge_date", label: "First recharge date", description: "Date of the user's first successful payment.", unit: "date", domain: "revenue", trust: "certified", owner: "khoi", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 9, mcp: 0, cdp: 3, savedViews: 11 } },
  { id: "bb.mf_users.install_date", type: "dimension", cube: "mf_users", member: "install_date", label: "Install date", description: "AppsFlyer attribution install date. NULL for organic / pre-attribution users — coverage gap.", unit: "date", domain: "acquisition", trust: "beta", drift: true, owner: "tuan", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 5, mcp: 0, cdp: 2, savedViews: 5 } },
  { id: "bb.mf_users.country", type: "dimension", cube: "mf_users", member: "country", label: "Country", description: "ISO-2 country code resolved at install or first active.", unit: "string", domain: "acquisition", trust: "certified", owner: "ngan", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 18, mcp: 4, cdp: 12, savedViews: 38 }, examples: ["VN", "TH", "ID"] },
  { id: "bb.mf_users.channel", type: "dimension", cube: "mf_users", member: "channel", label: "Channel", description: "Acquisition channel: organic / paid_install / cross_promo.", unit: "string", domain: "acquisition", trust: "certified", owner: "tuan", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 14, mcp: 0, cdp: 8, savedViews: 22 }, examples: ["organic", "facebook_ads", "google_ads", "tiktok"] },
  { id: "bb.mf_users.platform", type: "dimension", cube: "mf_users", member: "platform", label: "Platform (hub)", description: "Install platform: iOS / Android / Web.", unit: "string", domain: "acquisition", trust: "certified", owner: "ngan", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 24, mcp: 1, cdp: 10, savedViews: 30 } },
  { id: "bb.mf_users.gds_bundle_code", type: "dimension", cube: "mf_users", member: "gds_bundle_code", label: "GDS bundle code (tenant)", description: "Tenant key. POC scoped to `ballistar_vn`.", unit: "string", domain: "custom", trust: "certified", owner: "khoi", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 999, mcp: 5, cdp: 18, savedViews: 999 }, examples: ["ballistar_vn"] },
  { id: "bb.mf_users.appsflyer_id", type: "dimension", cube: "mf_users", member: "appsflyer_id", label: "AppsFlyer ID", description: "Bridge key to AppsFlyer attribution. NULL for users pre-SDK.", unit: "string", domain: "acquisition", trust: "beta", owner: "tuan", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 4, mcp: 0, cdp: 2, savedViews: 3 } },
  { id: "bb.mf_users.payer_tier", type: "dimension", cube: "mf_users", member: "payer_tier", label: "Payer tier", description: "Lifetime spend bucket: whale / dolphin / minnow / non_payer.", unit: "string", domain: "revenue", trust: "certified", owner: "minh", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 9, mcp: 2, cdp: 6, savedViews: 14 }, examples: ["whale", "dolphin", "minnow", "non_payer"] },

  // ─────── Segments (on mf_users) ───────
  { id: "bb.seg.whales",               type: "segment", cube: "mf_users", member: "whales",               label: "Whales",               description: "Users with ≥ 5,000,000 VND lifetime spend.",                       formulaText: "users WHERE `lifetime_revenue_vnd ≥ 5_000_000`",         unit: "boolean", domain: "revenue",     trust: "certified", synonyms: ["big spenders", "vip", "cá voi"], owner: "minh", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 7, mcp: 3, cdp: 9, savedViews: 18 } },
  { id: "bb.seg.dolphins",             type: "segment", cube: "mf_users", member: "dolphins",             label: "Dolphins",             description: "Users with 500K–5M VND lifetime spend.",                          formulaText: "users WHERE `lifetime_revenue_vnd BETWEEN 500_000 AND 5_000_000`", unit: "boolean", domain: "revenue", trust: "certified", owner: "minh", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 5, mcp: 1, cdp: 6, savedViews: 9 } },
  { id: "bb.seg.minnows",              type: "segment", cube: "mf_users", member: "minnows",              label: "Minnows",              description: "Users with < 500K VND lifetime spend.",                           formulaText: "users WHERE `lifetime_revenue_vnd < 500_000`",           unit: "boolean", domain: "revenue",     trust: "certified", owner: "minh", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 4, mcp: 1, cdp: 4, savedViews: 6 } },
  { id: "bb.seg.lapsed_payer_14d",     type: "segment", cube: "mf_users", member: "lapsed_payer_14d",     label: "Lapsed payer (14d)",   description: "Was a payer; no purchase in the last 14 days.",                   formulaText: "users WHERE `was_payer = true AND last_payment_at < today - 14d`", unit: "boolean", domain: "retention", trust: "certified", synonyms: ["churned payer", "winback"], owner: "minh", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 3, mcp: 2, cdp: 5, savedViews: 7 } },
  { id: "bb.seg.first_time_payer_30d", type: "segment", cube: "mf_users", member: "first_time_payer_30d", label: "First-time payer (30d)", description: "First successful payment within the last 30 days.",              formulaText: "users WHERE `first_recharge_date ≥ today - 30d`",       unit: "boolean", domain: "revenue",     trust: "beta",      owner: "tuan", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 2, mcp: 0, cdp: 3, savedViews: 4 } },
  { id: "bb.seg.vn_only",              type: "segment", cube: "mf_users", member: "vn_only",              label: "Vietnam only",         description: "country = 'VN'. Convenience segment for the core market.",       formulaText: "users WHERE `country = 'VN'`",                          unit: "boolean", domain: "acquisition", trust: "certified", owner: "ngan", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 28, mcp: 4, cdp: 14, savedViews: 32 } },
  { id: "bb.seg.paid_install",         type: "segment", cube: "mf_users", member: "paid_install",         label: "Paid install",         description: "First media_source ≠ organic — AppsFlyer-attributed paid acquisition.", formulaText: "users WHERE `appsflyer_first_media_source != 'organic'`", unit: "boolean", domain: "acquisition", trust: "beta", owner: "tuan", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 4, mcp: 0, cdp: 2, savedViews: 3 } },
];

// ═══════════════════════════════════════════════════════════════════════════
//  METRIC LAYER  —  21 business metrics from GDS-1.8 (Tier 1–3 only)
//  Each metric's `composedOf` lists tokens (other metrics or building blocks)
//  the formula references. The Catalog renders them as clickable chips.
// ═══════════════════════════════════════════════════════════════════════════
const METRICS = [
  // ────────── TIER 1 — Existing measure, single cube (8 metrics) ──────────
  {
    id: "m.dau", type: "metric", gdsRef: 13, standFor: "Daily Active Users",
    label: "DAU", tier: 1, domain: "engagement", unit: "users", trust: "certified",
    description: "Total number of unique users active today. A1 in the GDS A(n) family.",
    formula: { plain: "DAU = distinct users active on the report date" },
    composedOf: ["bb.active_daily.dau"],
    cubeQuery: { measures: ["active_daily.dau"], timeDimensions: [{ dimension: "active_daily.log_date", granularity: "day" }] },
    synonyms: ["daily active", "active users today", "DAU"],
    sampleQuestions: ["What's DAU in VN today?", "DAU trend last 14 days", "DAU by platform"],
    owner: "linh", refreshMinutes: 6, refreshSla: 30, certifiedAt: "2026-03-01",
    usedIn: { dashboards: 22, mcp: 5, cdp: 11, savedViews: 47 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.platform", "bb.mf_users.channel"],
    joinableSegments: ["bb.seg.whales", "bb.seg.vn_only", "bb.seg.paid_install"],
    spark: _spark(124_000, 0.05), current: 124_580, deltaPct: 2.1, anomaly: "none",
  },
  {
    id: "m.mau", type: "metric", gdsRef: 15, standFor: "Monthly Active Users",
    label: "MAU", tier: 1, domain: "engagement", unit: "users", trust: "certified",
    description: "Total unique users active in the calendar month. Each user is counted once per month.",
    formula: { plain: "MAU = distinct users active in the month" },
    composedOf: ["bb.active_daily.mau"],
    cubeQuery: { measures: ["active_daily.mau"], timeDimensions: [{ dimension: "active_daily.log_date", granularity: "month" }] },
    synonyms: ["monthly active"],
    sampleQuestions: ["MAU last 6 months", "MAU by country"],
    owner: "linh", refreshMinutes: 18, refreshSla: 60, certifiedAt: "2026-03-01",
    usedIn: { dashboards: 12, mcp: 1, cdp: 3, savedViews: 18 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.platform"],
    spark: _spark(640_000, 0.03), current: 638_900, deltaPct: 1.2, anomaly: "none",
  },
  {
    id: "m.transactions", type: "metric", gdsRef: 20, standFor: "Transactions",
    label: "Transactions", tier: 1, domain: "payments", unit: "count", trust: "certified",
    description: "Total number of successful payment transactions in the period.",
    formula: { plain: "Transactions = count of recharge rows" },
    composedOf: ["bb.recharge.transactions"],
    cubeQuery: { measures: ["recharge.transactions"], timeDimensions: [{ dimension: "recharge.recharge_date", granularity: "day" }] },
    synonyms: ["txns", "orders", "purchases"],
    sampleQuestions: ["Transactions by payment method", "Daily transactions last week"],
    owner: "ngan", refreshMinutes: 4, refreshSla: 30, certifiedAt: "2026-03-01",
    usedIn: { dashboards: 4, mcp: 0, cdp: 0, savedViews: 7 },
    sliceable: ["bb.recharge.payment_method", "bb.mf_users.country"],
    spark: _spark(11_200, 0.05), current: 11_540, deltaPct: 1.6, anomaly: "none",
  },
  {
    id: "m.revenue", type: "metric", gdsRef: 22, standFor: "Revenue",
    label: "Revenue", tier: 1, domain: "revenue", unit: "VND", trust: "certified",
    description: "Total value of in-game items successfully delivered to users in the period (VND). For POC, charge≈delivery is assumed.",
    formula: { plain: "Revenue = SUM(user_recharge_daily.revenue_vnd_total) over the period" },
    composedOf: ["bb.user_recharge_daily.revenue_vnd_total"],
    cubeQuery: { measures: ["user_recharge_daily.revenue_vnd_total"], timeDimensions: [{ dimension: "user_recharge_daily.log_date", granularity: "day" }] },
    synonyms: ["recharge", "income", "doanh thu", "iap revenue"],
    sampleQuestions: ["Revenue last 7 days", "Revenue by country", "VN whale revenue this month"],
    owner: "linh", refreshMinutes: 8, refreshSla: 60, certifiedAt: "2026-03-12",
    usedIn: { dashboards: 14, mcp: 3, cdp: 7, savedViews: 31 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.channel", "bb.mf_users.platform", "bb.mf_users.payer_tier"],
    joinableSegments: ["bb.seg.whales", "bb.seg.dolphins", "bb.seg.minnows", "bb.seg.vn_only", "bb.seg.lapsed_payer_14d"],
    spark: [422, 451, 438, 467, 512, 489, 503, 521, 498, 534, 561, 542, 558, 581].map(v => v * 1_000_000),
    current: 581_240_000, deltaPct: 4.2, anomaly: "none",
  },
  {
    id: "m.arpu_lifetime", type: "metric", gdsRef: 23, standFor: "Average Revenue Per User (lifetime)",
    label: "ARPU (lifetime)", tier: 1, domain: "revenue", unit: "VND", trust: "certified",
    description: "Lifetime average revenue per user — every user in mf_users, divided by their total revenue.",
    formula: { plain: "ARPU (lifetime) = mf_users.lifetime_revenue / mf_users.user_count" },
    composedOf: ["bb.mf_users.arpu_vnd"],
    cubeQuery: { measures: ["mf_users.arpu_vnd"] },
    sampleQuestions: ["Lifetime ARPU by channel", "Whale ARPU"],
    owner: "linh", refreshMinutes: 30, refreshSla: 120, certifiedAt: "2026-03-12",
    usedIn: { dashboards: 6, mcp: 0, cdp: 0, savedViews: 9 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.channel", "bb.mf_users.platform"],
    notes: "Period-scoped ARPU is composed from Revenue / DAU — see open question §5.1 caveat.",
    spark: _spark(18_500, 0.06), current: 19_240, deltaPct: -0.7, anomaly: "none",
  },
  {
    id: "m.arppu", type: "metric", gdsRef: 24, standFor: "Average Revenue Per Paying User",
    label: "ARPPU", tier: 1, domain: "revenue", unit: "VND", trust: "certified",
    description: "Revenue divided by paying users for the chosen period. Lifetime variant available on mf_users.",
    formula: { plain: "ARPPU = Revenue / Paying Users" },
    composedOf: ["m.revenue", "m.paying_users"],   // composes other METRICS
    cubeQuery: { measures: ["recharge.arppu_vnd"], timeDimensions: [{ dimension: "recharge.recharge_date", granularity: "day" }] },
    sampleQuestions: ["ARPPU by tier", "Is ARPPU rising?"],
    owner: "linh", refreshMinutes: 14, refreshSla: 60, certifiedAt: "2026-03-12",
    usedIn: { dashboards: 11, mcp: 1, cdp: 0, savedViews: 22 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.payer_tier"],
    spark: _spark(64_000, 0.04), current: 65_980, deltaPct: 1.2, anomaly: "low",
  },
  {
    id: "m.paying_rate_lifetime", type: "metric", gdsRef: "19a", standFor: "Paying Rate (lifetime)",
    label: "Paying Rate (lifetime)", tier: 1, domain: "revenue", unit: "%", trust: "certified",
    description: "Share of all users who have ever made a payment. Hub-grain — does not respect window filters.",
    formula: { plain: "Paying Rate (lifetime) = lifetime paying users / total users" },
    composedOf: ["bb.mf_users.paying_rate"],
    cubeQuery: { measures: ["mf_users.paying_rate"] },
    owner: "linh", refreshMinutes: 30, refreshSla: 120,
    usedIn: { dashboards: 4, mcp: 0, cdp: 0, savedViews: 6 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.channel"],
    spark: _spark(7.2, 0.02), current: 7.3, deltaPct: 0.4, anomaly: "none",
  },
  {
    id: "m.paying_rate_30d", type: "metric", gdsRef: "19b", standFor: "Paying Rate (rolling 30d)",
    label: "Paying Rate (rolling 30d)", tier: 1, domain: "revenue", unit: "%", trust: "certified",
    description: "Pre-aggregated rolling-30-day payers / actives. Faster than the period-scoped variant.",
    formula: { plain: "Paying Rate (30d) = mf_users.paying_users_30d / mf_users.active_users_30d" },
    composedOf: ["bb.mf_users.paying_rate_30d"],
    cubeQuery: { measures: ["mf_users.paying_rate_30d"] },
    owner: "linh", refreshMinutes: 30, refreshSla: 120,
    usedIn: { dashboards: 3, mcp: 0, cdp: 0, savedViews: 5 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.channel", "bb.mf_users.platform"],
    spark: _spark(6.8, 0.03), current: 6.9, deltaPct: 0.8, anomaly: "none",
  },

  // ────────── TIER 2 — Measure + time grain / segment (9 metrics) ──────────
  {
    id: "m.a_n", type: "metric", gdsRef: 13, standFor: "Active Users in n Days",
    label: "A(n)", tier: 2, domain: "engagement", unit: "users", trust: "certified",
    description: "Distinct users active in the trailing n days from the report date. n=1 is DAU.",
    formula: { plain: "A(n) = distinct users active on dates [today−(n−1) … today]" },
    composedOf: ["bb.active_daily.dau_exact"],
    parameter: { name: "n", values: [1, 3, 7, 14, 30, 60, 90], default: 7 },
    cubeQuery: { measures: ["active_daily.dau_exact"], timeDimensions: [{ dimension: "active_daily.log_date", dateRange: "last 7 days" }] },
    synonyms: ["a7", "a14", "active in n days"],
    sampleQuestions: ["A(7) by channel", "A(30) trend"],
    owner: "linh", refreshMinutes: 14, refreshSla: 60,
    usedIn: { dashboards: 5, mcp: 1, cdp: 2, savedViews: 8 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.channel"],
    spark: _spark(420_000, 0.04), current: 432_100, deltaPct: 1.8, anomaly: "none",
  },
  {
    id: "m.wau", type: "metric", gdsRef: 14, standFor: "Weekly Active User",
    label: "WAU", tier: 2, domain: "engagement", unit: "users", trust: "certified",
    description: "Distinct users active within the ISO week (Monday → Sunday). Each user counted once per week.",
    formula: { plain: "WAU = DAU rolled up to week granularity" },
    composedOf: ["bb.active_daily.dau"],
    cubeQuery: { measures: ["active_daily.dau"], timeDimensions: [{ dimension: "active_daily.log_date", granularity: "week" }] },
    sampleQuestions: ["WAU last 12 weeks", "WAU by country"],
    owner: "linh", refreshMinutes: 18, refreshSla: 60,
    usedIn: { dashboards: 8, mcp: 0, cdp: 1, savedViews: 11 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.platform"],
    spark: _spark(420_000, 0.03), current: 432_100, deltaPct: 1.5, anomaly: "none",
  },
  {
    id: "m.pu_n", type: "metric", gdsRef: 16, standFor: "Paying Users in n Days",
    label: "PU(n)", tier: 2, domain: "revenue", unit: "users", trust: "certified",
    description: "Distinct paying users in the trailing n days from the report date.",
    formula: { plain: "PU(n) = distinct users paying on dates [today−(n−1) … today]" },
    composedOf: ["bb.user_recharge_daily.paying_users"],
    parameter: { name: "n", values: [1, 3, 7, 14, 30], default: 7 },
    cubeQuery: { measures: ["user_recharge_daily.paying_users"], timeDimensions: [{ dimension: "user_recharge_daily.log_date", dateRange: "last 7 days" }] },
    synonyms: ["pu7", "paying users 7d"],
    sampleQuestions: ["PU(7) by country", "PU(30) trend"],
    owner: "linh", refreshMinutes: 9, refreshSla: 60,
    usedIn: { dashboards: 6, mcp: 1, cdp: 2, savedViews: 9 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.payer_tier"],
    joinableSegments: ["bb.seg.whales", "bb.seg.vn_only"],
    spark: _spark(28_400, 0.05), current: 29_240, deltaPct: 2.4, anomaly: "none",
  },
  {
    id: "m.wpu", type: "metric", gdsRef: 17, standFor: "Weekly Paying User",
    label: "WPU", tier: 2, domain: "revenue", unit: "users", trust: "certified",
    description: "Distinct paying users within the ISO week. Each user counted once per week.",
    formula: { plain: "WPU = Paying Users rolled up to week granularity" },
    composedOf: ["bb.user_recharge_daily.paying_users"],
    cubeQuery: { measures: ["user_recharge_daily.paying_users"], timeDimensions: [{ dimension: "user_recharge_daily.log_date", granularity: "week" }] },
    owner: "linh", refreshMinutes: 12, refreshSla: 60,
    usedIn: { dashboards: 5, mcp: 0, cdp: 1, savedViews: 7 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.payer_tier"],
    spark: _spark(28_400, 0.04), current: 29_240, deltaPct: 1.9, anomaly: "none",
  },
  {
    id: "m.mpu", type: "metric", gdsRef: 18, standFor: "Monthly Paying User",
    label: "MPU", tier: 2, domain: "revenue", unit: "users", trust: "certified",
    description: "Distinct paying users within the calendar month.",
    formula: { plain: "MPU = Paying Users rolled up to month granularity" },
    composedOf: ["bb.user_recharge_daily.paying_users"],
    cubeQuery: { measures: ["user_recharge_daily.paying_users"], timeDimensions: [{ dimension: "user_recharge_daily.log_date", granularity: "month" }] },
    owner: "linh", refreshMinutes: 18, refreshSla: 60,
    usedIn: { dashboards: 5, mcp: 0, cdp: 0, savedViews: 8 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.payer_tier"],
    spark: _spark(74_000, 0.03), current: 76_120, deltaPct: 1.4, anomaly: "none",
  },
  {
    id: "m.trailing_wau", type: "metric", gdsRef: 45, standFor: "Trailing Weekly Active User",
    label: "Trailing WAU", tier: 2, domain: "engagement", unit: "users", trust: "certified",
    description: "Distinct active users from the start of the current ISO week up to the report time.",
    formula: { plain: "Trailing WAU = DAU summed where log_date ≥ DATE_TRUNC('week', today)" },
    composedOf: ["bb.active_daily.dau"],
    cubeQuery: { measures: ["active_daily.dau"], filters: [{ member: "active_daily.log_date", operator: "afterDate", values: ["DATE_TRUNC('week', CURRENT_DATE)"] }] },
    owner: "linh", refreshMinutes: 8, refreshSla: 30,
    usedIn: { dashboards: 2, mcp: 0, cdp: 0, savedViews: 3 },
    spark: _spark(220_000, 0.04), current: 224_500, deltaPct: 2.1, anomaly: "none",
  },
  {
    id: "m.trailing_wpu", type: "metric", gdsRef: 46, standFor: "Trailing Weekly Paying User",
    label: "Trailing WPU", tier: 2, domain: "revenue", unit: "users", trust: "beta",
    description: "Distinct paying users from the start of the current ISO week up to the report time.",
    formula: { plain: "Trailing WPU = Paying Users where log_date ≥ DATE_TRUNC('week', today)" },
    composedOf: ["bb.user_recharge_daily.paying_users"],
    cubeQuery: { measures: ["user_recharge_daily.paying_users"], filters: [{ member: "user_recharge_daily.log_date", operator: "afterDate", values: ["DATE_TRUNC('week', CURRENT_DATE)"] }] },
    owner: "linh", refreshMinutes: 12, refreshSla: 60,
    usedIn: { dashboards: 1, mcp: 0, cdp: 0, savedViews: 2 },
    spark: _spark(14_400, 0.05), current: 14_860, deltaPct: 1.8, anomaly: "none",
  },
  {
    id: "m.trailing_mau", type: "metric", gdsRef: 47, standFor: "Trailing Monthly Active User",
    label: "Trailing MAU", tier: 2, domain: "engagement", unit: "users", trust: "certified",
    description: "Distinct active users from the start of the calendar month up to the report time.",
    formula: { plain: "Trailing MAU = DAU summed where log_date ≥ DATE_TRUNC('month', today)" },
    composedOf: ["bb.active_daily.dau"],
    cubeQuery: { measures: ["active_daily.dau"], filters: [{ member: "active_daily.log_date", operator: "afterDate", values: ["DATE_TRUNC('month', CURRENT_DATE)"] }] },
    owner: "linh", refreshMinutes: 12, refreshSla: 60,
    usedIn: { dashboards: 3, mcp: 0, cdp: 0, savedViews: 4 },
    spark: _spark(540_000, 0.03), current: 552_400, deltaPct: 1.4, anomaly: "none",
  },
  {
    id: "m.trailing_mpu", type: "metric", gdsRef: 48, standFor: "Trailing Monthly Paying User",
    label: "Trailing MPU", tier: 2, domain: "revenue", unit: "users", trust: "beta",
    description: "Distinct paying users from the start of the calendar month up to the report time.",
    formula: { plain: "Trailing MPU = Paying Users where log_date ≥ DATE_TRUNC('month', today)" },
    composedOf: ["bb.user_recharge_daily.paying_users"],
    cubeQuery: { measures: ["user_recharge_daily.paying_users"], filters: [{ member: "user_recharge_daily.log_date", operator: "afterDate", values: ["DATE_TRUNC('month', CURRENT_DATE)"] }] },
    owner: "linh", refreshMinutes: 18, refreshSla: 60,
    usedIn: { dashboards: 2, mcp: 0, cdp: 0, savedViews: 3 },
    spark: _spark(58_000, 0.04), current: 59_640, deltaPct: 1.6, anomaly: "none",
  },

  // ────────── Tier 2 caveat metrics (composed cross-cube ratios — POC client-side division) ──────────
  {
    id: "m.paying_users", type: "metric", gdsRef: "16/17/18", standFor: "Paying Users (period)",
    label: "Paying Users", tier: 2, domain: "revenue", unit: "users", trust: "certified",
    description: "Distinct paying users in the chosen period. The PU/WPU/MPU family rolled up by the time grain.",
    formula: { plain: "Paying Users = count_distinct(user_id) WHERE payment succeeded in period" },
    composedOf: ["bb.user_recharge_daily.paying_users"],
    cubeQuery: { measures: ["user_recharge_daily.paying_users"], timeDimensions: [{ dimension: "user_recharge_daily.log_date" }] },
    synonyms: ["pu", "payers"],
    sampleQuestions: ["Paying users by tier", "Paying users in VN this week"],
    owner: "linh", refreshMinutes: 9, refreshSla: 60, certifiedAt: "2026-03-01",
    usedIn: { dashboards: 18, mcp: 4, cdp: 9, savedViews: 26 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.payer_tier", "bb.mf_users.channel"],
    spark: _spark(28_400, 0.05), current: 29_240, deltaPct: 2.4, anomaly: "none",
  },

  // ────────── TIER 3 — Cohort filter on mf_users anchors (5 metrics) ──────────
  {
    id: "m.nru", type: "metric", gdsRef: 11, standFor: "New Register Users",
    label: "NRU", tier: 3, domain: "acquisition", unit: "users", trust: "certified",
    description: "Distinct users whose first_active_date falls in the period.",
    formula: { plain: "NRU = mf_users.user_count_approx WHERE first_active_date ∈ period" },
    composedOf: ["bb.mf_users.user_count_approx", "bb.mf_users.first_active_date"],
    cubeQuery: { measures: ["mf_users.user_count_approx"], filters: [{ member: "mf_users.first_active_date", operator: "inDateRange", values: ["<from>", "<to>"] }] },
    synonyms: ["new register", "new users", "first active"],
    sampleQuestions: ["NRU by channel last 7 days", "VN NRU this month"],
    owner: "tuan", refreshMinutes: 30, refreshSla: 60, certifiedAt: "2026-04-01",
    usedIn: { dashboards: 11, mcp: 1, cdp: 4, savedViews: 16 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.channel", "bb.mf_users.platform"],
    joinableSegments: ["bb.seg.vn_only", "bb.seg.paid_install"],
    spark: _spark(2_400, 0.1), current: 2_580, deltaPct: 6.2, anomaly: "low",
  },
  {
    id: "m.npu", type: "metric", gdsRef: 25, standFor: "New Paying Users",
    label: "NPU", tier: 3, domain: "revenue", unit: "users", trust: "certified",
    description: "Distinct users whose first_recharge_date falls in the period.",
    formula: { plain: "NPU = mf_users.user_count_approx WHERE first_recharge_date ∈ period" },
    composedOf: ["bb.mf_users.user_count_approx", "bb.mf_users.first_recharge_date"],
    cubeQuery: { measures: ["mf_users.user_count_approx"], filters: [{ member: "mf_users.first_recharge_date", operator: "inDateRange", values: ["<from>", "<to>"] }] },
    synonyms: ["new payers", "ftp", "first-time payer"],
    sampleQuestions: ["NPU by channel", "NPU in VN last week"],
    owner: "tuan", refreshMinutes: 30, refreshSla: 60,
    usedIn: { dashboards: 5, mcp: 1, cdp: 2, savedViews: 8 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.channel"],
    spark: _spark(380, 0.12), current: 412, deltaPct: 8.7, anomaly: "low",
  },
  {
    id: "m.revnpu", type: "metric", gdsRef: 26, standFor: "Revenue from New Paying Users",
    label: "RevNPU", tier: 3, domain: "revenue", unit: "VND", trust: "certified",
    description: "Revenue from users whose first_recharge_date is in the period — recharges made during the same period.",
    formula: { plain: "RevNPU = recharge.revenue_vnd JOIN mf_users WHERE first_recharge_date ∈ period AND recharge_date ∈ period" },
    composedOf: ["bb.recharge.revenue_vnd", "bb.mf_users.first_recharge_date"],
    cubeQuery: { measures: ["recharge.revenue_vnd"], filters: [{ member: "mf_users.first_recharge_date", operator: "inDateRange", values: ["<from>", "<to>"] }, { member: "recharge.recharge_date", operator: "inDateRange", values: ["<from>", "<to>"] }] },
    sampleQuestions: ["RevNPU by channel", "RevNPU trend"],
    owner: "linh", refreshMinutes: 12, refreshSla: 60,
    usedIn: { dashboards: 3, mcp: 0, cdp: 0, savedViews: 4 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.channel"],
    spark: _spark(78_000_000, 0.1), current: 84_200_000, deltaPct: 7.9, anomaly: "low",
  },
  {
    id: "m.arpnpu", type: "metric", gdsRef: 27, standFor: "Average Revenue Per New Paying User",
    label: "ARPNPU", tier: 3, domain: "revenue", unit: "VND", trust: "certified",
    description: "Per-user revenue across the NPU cohort. POC v0 ships as client-side RevNPU / NPU.",
    formula: { plain: "ARPNPU = RevNPU / NPU" },
    composedOf: ["m.revnpu", "m.npu"],     // composes other METRICS
    cubeQuery: { /* client-side division per POC v0 */ },
    owner: "linh", refreshMinutes: 14, refreshSla: 60,
    usedIn: { dashboards: 2, mcp: 0, cdp: 0, savedViews: 3 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.channel"],
    spark: _spark(204_000, 0.04), current: 204_400, deltaPct: -0.6, anomaly: "none",
  },
  {
    id: "m.nnpu", type: "metric", gdsRef: 28, standFor: "New Register & New Paying User",
    label: "NNPU", tier: 3, domain: "revenue", unit: "users", trust: "beta",
    description: "Users where both first_active_date AND first_recharge_date fall in the period. Same-period sign-up + first payment.",
    formula: { plain: "NNPU = mf_users.user_count_approx WHERE first_active_date ∈ period AND first_recharge_date ∈ period" },
    composedOf: ["bb.mf_users.user_count_approx", "bb.mf_users.first_active_date", "bb.mf_users.first_recharge_date"],
    cubeQuery: { measures: ["mf_users.user_count_approx"], filters: [
      { member: "mf_users.first_active_date", operator: "inDateRange", values: ["<from>", "<to>"] },
      { member: "mf_users.first_recharge_date", operator: "inDateRange", values: ["<from>", "<to>"] },
    ]},
    owner: "tuan", refreshMinutes: 30, refreshSla: 60,
    usedIn: { dashboards: 1, mcp: 0, cdp: 1, savedViews: 2 },
    sliceable: ["bb.mf_users.country", "bb.mf_users.channel"],
    spark: _spark(180, 0.15), current: 198, deltaPct: 10.2, anomaly: "low",
  },
];

// ─── Activity (Metric Detail panel) ───
const ACTIVITY = [
  { id: 1, type: "edit",     actor: "linh", at: "2026-05-18 14:22", text: "Updated description: '… Excludes refunds and chargebacks.'" },
  { id: 2, type: "feedback", actor: "minh", at: "2026-05-17 09:08", verdict: "up", text: "Crystal clear — used in today's campaign brief." },
  { id: 3, type: "save",     actor: "tuan", at: "2026-05-16 16:41", text: "Saved view 'VN whales — revenue WoW'." },
  { id: 4, type: "feedback", actor: "hieu", at: "2026-05-15 11:00", verdict: "down", text: "Should clarify timezone — is this UTC or VN local?" },
  { id: 5, type: "publish",  actor: "linh", at: "2026-05-12 10:33", text: "Promoted from Beta to Certified." },
];

// ─── Saved views ───
const SAVED_VIEWS = [
  { id: "v.vn_whales_wow", name: "VN whales — revenue WoW",  owner: "minh", lastRun: "2 hours ago", measures: ["m.revenue"],         dimensions: ["bb.active_daily.log_date"], filters: ["bb.seg.whales", "bb.seg.vn_only"], comparison: "vs last 7d" },
  { id: "v.dau_by_country", name: "DAU by country (top 5)",  owner: "linh", lastRun: "yesterday",   measures: ["m.dau"],             dimensions: ["bb.mf_users.country"], filters: [], limit: 5 },
  { id: "v.arppu_drift",    name: "ARPPU drift watch",        owner: "linh", lastRun: "3 days ago", measures: ["m.arppu"],           dimensions: ["bb.active_daily.log_date"], filters: [] },
  { id: "v.lapsed_winback", name: "Lapsed payer winback",     owner: "minh", lastRun: "5 hours ago", measures: ["m.paying_users"],   dimensions: ["bb.mf_users.payer_tier"], filters: ["bb.seg.lapsed_payer_14d", "bb.seg.vn_only"] },
];

// ─── Notifications ───
const NOTIFICATIONS = [
  { id: 1, type: "anomaly",  ts: "12 min ago", title: "NPU up sharply (+8.7%)",       concept: "m.npu",     state: "low" },
  { id: 2, type: "anomaly",  ts: "2 hours ago", title: "NNPU trending up",            concept: "m.nnpu",    state: "low" },
  { id: 3, type: "edit",     ts: "yesterday",   title: "Linh Pham edited 'Revenue'",  concept: "m.revenue" },
  { id: 4, type: "feedback", ts: "yesterday",   title: "Hieu Dang left feedback on ARPPU", concept: "m.arppu" },
  { id: 5, type: "digest",   ts: "2 days ago",  title: "Weekly digest: 5 metrics tracked", concept: null },
];

// ─── Lineage (Metric Detail · graph) ───
const LINEAGE = {
  "m.revenue": {
    upstream: [
      { id: "wh.recharge", type: "warehouse_table", label: "warehouse.public.recharge_log", meta: "rows · 412M / refreshed 8m" },
      { id: "cube.user_recharge_daily", type: "cube", label: "user_recharge_daily", meta: "Cube YAML" },
      { id: "bb.user_recharge_daily.revenue_vnd_total", type: "concept", label: "revenue_vnd_total", meta: "building block (measure)" },
    ],
    downstream: [
      { id: "view.vn_whales_wow", type: "saved_view",  label: "VN whales — revenue WoW",        meta: "by Minh" },
      { id: "dash.exec_overview", type: "dashboard",   label: "Exec overview (Looker)",         meta: "external" },
      { id: "dash.finance_mtd",   type: "dashboard",   label: "Finance MTD",                    meta: "Tableau" },
      { id: "mcp.revenue_alerts", type: "mcp_tool",    label: "revenue_alerts (MCP)",           meta: "agentic tool" },
      { id: "cdp.lapsed_payer",   type: "cdp_audience",label: "lapsed_payer_14d (CDP)",         meta: "Segment.com" },
    ],
    composed: [
      { id: "m.arppu",      label: "ARPPU = Revenue / Paying Users" },
      { id: "m.arpu_lifetime", label: "ARPU (lifetime) is hub-grain — not composed from Revenue" },
    ],
  },
};

// ─── Change analysis (Why did revenue move?) ───
const CHANGE_ANALYSIS = {
  "m.revenue": {
    headline: "Revenue dropped 8.4% vs last week",
    delta: -8.4, confidence: 0.82,
    breakdowns: [
      { dim: "Country", rows: [
        { value: "VN", contribution: -22, current: 318_400_000, prev: 408_300_000 },
        { value: "TH", contribution:  -3, current:  92_100_000, prev:  95_000_000 },
        { value: "ID", contribution:  +5, current: 110_500_000, prev: 105_100_000 },
        { value: "PH", contribution:  -1, current:  44_200_000, prev:  44_700_000 },
      ]},
      { dim: "Channel", rows: [
        { value: "facebook_ads", contribution: -18, current: 144_000_000, prev: 175_600_000 },
        { value: "google_ads",   contribution:  -2, current:  88_500_000, prev:  90_300_000 },
        { value: "organic",      contribution:  +4, current: 184_000_000, prev: 176_900_000 },
        { value: "tiktok",       contribution:  -1, current:  61_000_000, prev:  61_600_000 },
      ]},
      { dim: "Payer Tier", rows: [
        { value: "whale",   contribution: -34, current: 199_000_000, prev: 301_500_000 },
        { value: "dolphin", contribution:  -5, current: 142_000_000, prev: 149_500_000 },
        { value: "minnow",  contribution:   0, current:  92_000_000, prev:  92_000_000 },
      ]},
    ],
    suspectedCause: { dim: "Payer Tier", value: "whale", reason: "Whale revenue fell 34%, accounting for ~89% of the total drop." },
  },
};

// ─── Cube → human-readable label ───
const CUBES = {
  mf_users:            { label: "mf_users",            grain: "1 row / user",          icon: "circle-user-round" },
  active_daily:        { label: "active_daily",        grain: "1 row / user / active day",   icon: "calendar-clock" },
  user_recharge_daily: { label: "user_recharge_daily", grain: "1 row / user / recharge day", icon: "wallet" },
  recharge:            { label: "recharge",            grain: "1 row / transaction",   icon: "receipt" },
};

// ═══════════════════════════════════════════════════════════════════════════
//  LOOKUPS  —  unified so detail pages don't care which layer an id is from.
// ═══════════════════════════════════════════════════════════════════════════
const METRIC_BY_ID  = Object.fromEntries(METRICS.map(m => [m.id, m]));
const CONCEPT_BY_ID = Object.fromEntries(CONCEPTS.map(c => [c.id, c]));
const CATALOG_BY_ID = { ...METRIC_BY_ID, ...CONCEPT_BY_ID };
const CONCEPT_BY_REF = Object.fromEntries(CONCEPTS.map(c => [`${c.cube}.${c.member}`, c]));

Object.assign(window, {
  OWNERS, TIER_INFO, CUBES,
  METRICS, CONCEPTS, METRIC_BY_ID, CONCEPT_BY_ID, CATALOG_BY_ID, CONCEPT_BY_REF,
  ACTIVITY, SAVED_VIEWS, NOTIFICATIONS, LINEAGE, CHANGE_ANALYSIS,
});
