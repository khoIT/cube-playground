/* global window */
/* Seed data for Compass. Mirrors the GDS-1.8 vocabulary referenced in the PRD —
   4 cubes (revenue, users, sessions, payments), 53 concepts across measure/dim/segment. */

// Owners
const OWNERS = {
  khoi:  { id: "khoi",  name: "Khoi Tran",  team: "Data Platform" },
  linh:  { id: "linh",  name: "Linh Pham",  team: "Game Analytics" },
  minh:  { id: "minh",  name: "Minh Vo",    team: "Liveops" },
  tuan:  { id: "tuan",  name: "Tuan Le",    team: "Growth" },
  ngan:  { id: "ngan",  name: "Ngan Nguyen",team: "Data Platform" },
  hieu:  { id: "hieu",  name: "Hieu Dang",  team: "Finance" },
};

// Sample sparkline data (14-day arrays so they're realistic)
const _spark = (base, vol = 0.1, len = 14) => {
  const out = []; let v = base;
  for (let i = 0; i < len; i++) {
    v = v + (Math.sin(i * 0.7) * vol * base * 0.3) + (Math.cos(i * 1.3) * vol * base * 0.2);
    out.push(Math.max(0, Math.round(v)));
  }
  return out;
};

// CONCEPTS — every measure / dimension / segment we mock.
const CONCEPTS = [
  // ───────── MEASURES — Revenue domain ─────────
  {
    id: "revenue.total_vnd", type: "measure", cube: "revenue", member: "total_vnd",
    label: "Revenue (VND)",
    description: "Sum of completed in-app purchase and recharge transactions, in Vietnamese Đồng. Excludes refunds and chargebacks.",
    formulaText: "**Revenue** = `SUM(payments.amount_vnd)` WHERE `status = 'completed'` AND `refunded_at IS NULL`",
    unit: "VND", domain: "revenue", trust: "certified",
    synonyms: ["recharge", "income", "topup", "iap revenue", "doanh thu"],
    sampleQuestions: ["What's revenue in VN last 7 days?", "Compare IAP revenue across channels", "Whale revenue this month vs last"],
    owner: "linh", lastEditedBy: "linh", lastEditedAt: "2026-05-18T14:22:00Z",
    refreshMinutes: 8, refreshSla: 60, certifiedAt: "2026-03-12",
    usedIn: { dashboards: 14, mcp: 3, cdp: 7, savedViews: 31 },
    sliceable: ["country", "channel", "platform", "payer_tier", "game", "day"],
    joinableSegments: ["whales", "dolphins", "minnows", "lapsed_payer_14d", "first_time_payer_30d"],
    similar: ["revenue.iap_vnd", "revenue.recharge_vnd", "payments.gross_vnd"],
    spark: [422, 451, 438, 467, 512, 489, 503, 521, 498, 534, 561, 542, 558, 581],
    current: 581_240_000, deltaPct: 4.2, anomaly: "none",
  },
  {
    id: "revenue.iap_vnd", type: "measure", cube: "revenue", member: "iap_vnd",
    label: "IAP Revenue (VND)", description: "Revenue from in-app purchases only — excludes ad revenue and platform recharge.",
    formulaText: "**IAP Revenue** = `SUM(payments.amount_vnd)` WHERE `source = 'iap'`",
    unit: "VND", domain: "revenue", trust: "certified",
    synonyms: ["in-app", "store revenue", "purchase"],
    sampleQuestions: ["IAP by platform?", "iOS vs Android IAP this week"],
    owner: "linh", refreshMinutes: 12, refreshSla: 60,
    usedIn: { dashboards: 8, mcp: 2, cdp: 3, savedViews: 14 },
    sliceable: ["country", "platform", "payer_tier"], joinableSegments: ["whales", "dolphins"],
    similar: ["revenue.total_vnd"], spark: _spark(400_000_000, 0.08), current: 412_500_000, deltaPct: 3.1, anomaly: "none",
  },
  {
    id: "revenue.arppu_vnd", type: "measure", cube: "revenue", member: "arppu_vnd",
    label: "ARPPU (VND)", description: "Average revenue per paying user. Composed: total revenue / paying users.",
    formulaText: "**ARPPU** = `revenue.total_vnd` / `users.paying_users`",
    unit: "VND", domain: "revenue", trust: "certified",
    synonyms: ["arppu", "avg payer revenue", "rev per payer"],
    sampleQuestions: ["ARPPU by tier", "Is ARPPU growing this month?"],
    owner: "linh", refreshMinutes: 14, refreshSla: 60,
    usedIn: { dashboards: 11, mcp: 1, cdp: 0, savedViews: 22 },
    sliceable: ["country", "payer_tier", "game", "day"],
    similar: ["revenue.arpu_vnd", "revenue.ltv_total_vnd"], composedOf: ["revenue.total_vnd", "users.paying_users"],
    spark: _spark(245_000, 0.05), current: 254_320, deltaPct: 1.8, anomaly: "low",
  },
  {
    id: "revenue.arpu_vnd", type: "measure", cube: "revenue", member: "arpu_vnd",
    label: "ARPU (VND)", description: "Average revenue per user, paying or not. Revenue / DAU.",
    formulaText: "**ARPU** = `revenue.total_vnd` / `users.dau`",
    unit: "VND", domain: "revenue", trust: "certified",
    synonyms: ["arpu", "rev per user"],
    owner: "linh", refreshMinutes: 14, refreshSla: 60,
    sampleQuestions: ["ARPU vs ARPPU drift", "ARPU by country"],
    usedIn: { dashboards: 6, mcp: 0, cdp: 0, savedViews: 9 },
    similar: ["revenue.arppu_vnd"], spark: _spark(18_500, 0.06), current: 19_240, deltaPct: -0.7, anomaly: "none",
  },
  {
    id: "revenue.ltv_total_vnd", type: "measure", cube: "revenue", member: "ltv_n_vnd",
    label: "LTV(n)", description: "Lifetime value at n days post-install. Parameterised by n.",
    formulaText: "**LTV(n)** = `SUM(revenue.total_vnd)` for users WHERE `days_since_install ≤ n`",
    parameter: { name: "n", values: [1, 3, 7, 14, 30, 60, 90, 120, 150, 180], default: 7 },
    unit: "VND", domain: "revenue", trust: "certified",
    synonyms: ["lifetime value", "ltv"],
    sampleQuestions: ["LTV(7) by channel", "Whale LTV(30) trend"],
    owner: "linh", refreshMinutes: 22, refreshSla: 120,
    usedIn: { dashboards: 9, mcp: 2, cdp: 4, savedViews: 18 },
    sliceable: ["channel", "country", "cohort_day"], similar: ["revenue.arppu_vnd"],
    spark: _spark(85_000, 0.04), current: 87_120, deltaPct: 2.4, anomaly: "none",
  },
  {
    id: "payments.gross_vnd", type: "measure", cube: "payments", member: "gross_vnd",
    label: "Gross Payments (VND)", description: "Pre-fee, pre-refund payments volume.",
    formulaText: "**Gross** = `SUM(payments.amount_vnd)`",
    unit: "VND", domain: "payments", trust: "beta",
    synonyms: ["gross", "pre-fee"],
    owner: "ngan", refreshMinutes: 6, refreshSla: 60,
    usedIn: { dashboards: 2, mcp: 0, cdp: 0, savedViews: 3 },
    spark: _spark(620_000_000, 0.1), current: 642_120_000, deltaPct: 5.1, anomaly: "low",
  },
  {
    id: "payments.refund_rate", type: "measure", cube: "payments", member: "refund_rate",
    label: "Refund Rate", description: "Refunded transaction count / total transaction count.",
    formulaText: "**Refund Rate** = `COUNT(refunded) / COUNT(*)`",
    unit: "%", domain: "payments", trust: "certified",
    synonyms: ["refund pct", "refunds", "chargeback"],
    owner: "ngan", refreshMinutes: 4, refreshSla: 60,
    usedIn: { dashboards: 4, mcp: 0, cdp: 0, savedViews: 7 },
    spark: [0.8, 0.9, 0.7, 0.9, 1.1, 0.9, 1.0, 1.2, 1.1, 1.3, 1.7, 1.9, 2.2, 2.8].map(v => Math.round(v * 100)),
    current: 2.8, deltaPct: 154, anomaly: "high",
  },

  // ───────── MEASURES — Engagement / Users ─────────
  {
    id: "users.dau", type: "measure", cube: "users", member: "dau",
    label: "DAU", description: "Daily Active Users — distinct users with at least one session today.",
    formulaText: "**DAU** = `COUNT(DISTINCT user_id)` WHERE `session_start::date = today`",
    unit: "users", domain: "engagement", trust: "certified",
    synonyms: ["daily active", "daus", "active users", "logged in"],
    sampleQuestions: ["DAU last 7 days", "DAU by country in VN"],
    owner: "linh", refreshMinutes: 6, refreshSla: 30,
    usedIn: { dashboards: 22, mcp: 5, cdp: 11, savedViews: 47 },
    sliceable: ["country", "platform", "channel", "game", "day"],
    similar: ["users.mau", "users.wau"], spark: _spark(120_000, 0.05), current: 124_580, deltaPct: 2.1, anomaly: "none",
  },
  {
    id: "users.mau", type: "measure", cube: "users", member: "mau",
    label: "MAU", description: "Monthly Active Users — distinct users active in the last 30 days.",
    formulaText: "**MAU** = `COUNT(DISTINCT user_id)` WHERE `session_start ≥ today - 30d`",
    unit: "users", domain: "engagement", trust: "certified",
    synonyms: ["monthly active"], owner: "linh", refreshMinutes: 18, refreshSla: 60,
    usedIn: { dashboards: 12, mcp: 1, cdp: 3, savedViews: 18 },
    spark: _spark(620_000, 0.03), current: 638_900, deltaPct: 1.2, anomaly: "none",
  },
  {
    id: "users.paying_users", type: "measure", cube: "users", member: "paying_users",
    label: "Paying Users", description: "Users with at least one completed payment in the period.",
    formulaText: "**Paying Users** = `COUNT(DISTINCT user_id)` WHERE `payments.status = 'completed'`",
    unit: "users", domain: "revenue", trust: "certified",
    synonyms: ["payers", "pus", "paid users", "spenders"],
    sampleQuestions: ["Paying users by tier", "New payers this week"],
    owner: "linh", refreshMinutes: 9, refreshSla: 60,
    usedIn: { dashboards: 18, mcp: 4, cdp: 9, savedViews: 26 },
    sliceable: ["country", "payer_tier", "channel"],
    similar: ["users.new_payers", "revenue.arppu_vnd"],
    drift: true,   // game-specific override
    spark: _spark(8_400, 0.06), current: 8_720, deltaPct: 1.4, anomaly: "none",
  },
  {
    id: "users.new_payers", type: "measure", cube: "users", member: "new_payers",
    label: "New Payers", description: "First-time payers in the period.",
    formulaText: "**New Payers** = `COUNT(DISTINCT user_id)` WHERE `first_payment_at` is in period",
    unit: "users", domain: "revenue", trust: "beta",
    synonyms: ["ftp", "first-time payer", "ftd"], owner: "tuan",
    refreshMinutes: 11, refreshSla: 60,
    usedIn: { dashboards: 5, mcp: 1, cdp: 2, savedViews: 8 },
    spark: _spark(380, 0.12), current: 412, deltaPct: 8.7, anomaly: "low",
  },
  {
    id: "engagement.session_count", type: "measure", cube: "sessions", member: "count",
    label: "Sessions", description: "Total session count in the period.",
    formulaText: "**Sessions** = `COUNT(*)` FROM `sessions`",
    unit: "sessions", domain: "engagement", trust: "certified",
    owner: "linh", refreshMinutes: 4, refreshSla: 30,
    usedIn: { dashboards: 9, mcp: 0, cdp: 0, savedViews: 14 },
    spark: _spark(540_000, 0.04), current: 552_300, deltaPct: 1.1, anomaly: "none",
  },
  {
    id: "engagement.session_minutes", type: "measure", cube: "sessions", member: "minutes",
    label: "Session Minutes", description: "Sum of minutes spent in session.",
    formulaText: "**Session Minutes** = `SUM(session_duration_min)`",
    unit: "min", domain: "engagement", trust: "certified",
    owner: "linh", refreshMinutes: 4, refreshSla: 30,
    usedIn: { dashboards: 6, mcp: 0, cdp: 0, savedViews: 7 },
    spark: _spark(8_400_000, 0.04), current: 8_510_000, deltaPct: 0.7, anomaly: "none",
  },
  {
    id: "retention.dn", type: "measure", cube: "users", member: "retention_n",
    label: "Retention D(n)", description: "Percentage of installs returning n days later.",
    formulaText: "**D(n)** = `users active on day n / users installed on day 0`",
    parameter: { name: "n", values: [1, 3, 7, 14, 30, 60, 90], default: 7 },
    unit: "%", domain: "retention", trust: "certified",
    synonyms: ["d1", "d7", "retention", "return rate"],
    sampleQuestions: ["D1 retention by channel", "D7 trend last 90 days"],
    owner: "tuan", refreshMinutes: 35, refreshSla: 240,
    usedIn: { dashboards: 14, mcp: 2, cdp: 5, savedViews: 19 },
    spark: _spark(42, 0.04), current: 41.2, deltaPct: -2.4, anomaly: "low",
  },
  {
    id: "acquisition.installs", type: "measure", cube: "users", member: "installs",
    label: "Installs", description: "New installs in the period.",
    formulaText: "**Installs** = `COUNT(*) FROM users WHERE installed_at` in period",
    unit: "installs", domain: "acquisition", trust: "certified",
    synonyms: ["downloads", "new users"],
    sampleQuestions: ["Installs by channel", "VN installs this week"],
    owner: "tuan", refreshMinutes: 7, refreshSla: 60,
    usedIn: { dashboards: 11, mcp: 1, cdp: 4, savedViews: 16 },
    spark: _spark(2_400, 0.1), current: 2_580, deltaPct: 6.2, anomaly: "low",
  },
  {
    id: "concurrency.ccu_peak", type: "measure", cube: "sessions", member: "ccu_peak",
    label: "Peak CCU", description: "Highest concurrent user count observed in the period.",
    formulaText: "**Peak CCU** = `MAX(concurrent_users_by_minute)`",
    unit: "users", domain: "concurrency", trust: "certified",
    synonyms: ["ccu", "concurrent", "peak"], owner: "linh",
    refreshMinutes: 2, refreshSla: 10,
    usedIn: { dashboards: 4, mcp: 0, cdp: 0, savedViews: 6 },
    spark: _spark(22_000, 0.08), current: 23_400, deltaPct: 3.5, anomaly: "none",
  },
  {
    id: "marketing.cpi_vnd", type: "measure", cube: "users", member: "cpi_vnd",
    label: "CPI (VND)", description: "Cost per install — UA spend / installs.",
    formulaText: "**CPI** = `marketing_spend_vnd / installs`",
    unit: "VND", domain: "marketing", trust: "beta",
    synonyms: ["cost per install", "ua cost"], owner: "tuan",
    refreshMinutes: 30, refreshSla: 240,
    usedIn: { dashboards: 7, mcp: 0, cdp: 0, savedViews: 9 },
    spark: _spark(38_000, 0.06), current: 39_200, deltaPct: 3.2, anomaly: "none",
  },
  {
    id: "marketing.roas_d7", type: "measure", cube: "users", member: "roas_d7",
    label: "ROAS D7", description: "Return on ad spend at 7 days.",
    formulaText: "**ROAS D7** = `LTV(7) / CPI`",
    unit: "x", domain: "marketing", trust: "beta",
    synonyms: ["roas", "return on ad spend"], owner: "tuan",
    refreshMinutes: 45, refreshSla: 240,
    usedIn: { dashboards: 5, mcp: 0, cdp: 0, savedViews: 6 },
    spark: _spark(2.2, 0.08).map(v => Math.round(v * 10) / 10), current: 2.4, deltaPct: 4.3, anomaly: "none",
  },

  // ───────── A few less-loved ones (states variety) ─────────
  {
    id: "users.churn_30d", type: "measure", cube: "users", member: "churn_30d",
    label: "30-day Churn", description: "Pct of payers who were active 30d ago and inactive today.",
    formulaText: "**Churn 30d** = `inactive_now / active_30d_ago`",
    unit: "%", domain: "retention", trust: "draft",
    owner: "tuan", refreshMinutes: 110, refreshSla: 60,  // stale
    usedIn: { dashboards: 0, mcp: 0, cdp: 0, savedViews: 1 },
    spark: _spark(12, 0.1), current: 14.2, deltaPct: 18, anomaly: "high",
  },
  {
    id: "revenue.ad_vnd", type: "measure", cube: "revenue", member: "ad_vnd_old",
    label: "Ad Revenue (legacy)", description: "Deprecated. Use `revenue.total_vnd` minus `revenue.iap_vnd` going forward.",
    unit: "VND", domain: "revenue", trust: "deprecated",
    owner: "linh", refreshMinutes: 360, refreshSla: 60,
    usedIn: { dashboards: 1, mcp: 0, cdp: 0, savedViews: 0 },
    spark: _spark(50_000_000, 0.05), current: 51_120_000, deltaPct: -42, anomaly: "trend",
  },
  {
    id: "users.x_legacy_cohort", type: "measure", cube: "users", member: "x_legacy_cohort",
    label: "Legacy cohort score",
    description: "Metadata exists but the underlying cube member was renamed and not relinked.",
    unit: "score", domain: "custom", trust: "orphaned",
    owner: "khoi", refreshMinutes: 999, refreshSla: 60,
    usedIn: { dashboards: 0, mcp: 0, cdp: 0, savedViews: 2 },
  },

  // ───────── DIMENSIONS ─────────
  { id: "dim.country", type: "dimension", cube: "users", member: "country", label: "Country", description: "ISO-2 country code resolved from billing or IP at install.", unit: "string", domain: "acquisition", trust: "certified", owner: "ngan", refreshMinutes: 12, refreshSla: 60, usedIn: { dashboards: 18, mcp: 4, cdp: 12, savedViews: 38 }, examples: ["VN", "TH", "ID", "PH", "MY"] },
  { id: "dim.channel", type: "dimension", cube: "users", member: "channel", label: "Acquisition Channel", description: "Where the user came from at install. Includes organic / paid / influencer / cross-promo.", unit: "string", domain: "acquisition", trust: "certified", owner: "tuan", refreshMinutes: 12, refreshSla: 60, usedIn: { dashboards: 14, mcp: 0, cdp: 8, savedViews: 22 }, examples: ["organic", "facebook_ads", "google_ads", "tiktok", "cross_promo"] },
  { id: "dim.platform", type: "dimension", cube: "users", member: "platform", label: "Platform", description: "iOS / Android / Web client.", unit: "string", domain: "acquisition", trust: "certified", owner: "ngan", refreshMinutes: 6, refreshSla: 60, usedIn: { dashboards: 24, mcp: 1, cdp: 10, savedViews: 30 }, examples: ["ios", "android", "web"] },
  { id: "dim.payer_tier", type: "dimension", cube: "users", member: "payer_tier", label: "Payer Tier", description: "Cohort by 30-day spend: minnow / dolphin / whale.", unit: "string", domain: "revenue", trust: "certified", owner: "minh", refreshMinutes: 30, refreshSla: 60, usedIn: { dashboards: 9, mcp: 2, cdp: 6, savedViews: 14 }, examples: ["whale", "dolphin", "minnow", "non_payer"] },
  { id: "dim.game", type: "dimension", cube: "users", member: "game", label: "Game", description: "Game title — used for multi-title rollups.", unit: "string", domain: "acquisition", trust: "certified", owner: "khoi", refreshMinutes: 6, refreshSla: 60, usedIn: { dashboards: 30, mcp: 5, cdp: 18, savedViews: 50 }, examples: ["ballistar", "league_of_thieves", "speed_lane"] },
  { id: "dim.day", type: "dimension", cube: "sessions", member: "day", label: "Day", description: "Calendar day (UTC+7).", unit: "date", domain: "custom", trust: "certified", owner: "khoi", refreshMinutes: 1, refreshSla: 60, usedIn: { dashboards: 999, mcp: 0, cdp: 0, savedViews: 999 } },

  // ───────── SEGMENTS ─────────
  { id: "seg.whales", type: "segment", cube: "users", member: "whales", label: "Whales", description: "Users with ≥ 5,000,000 VND spend in the last 30 days.", formulaText: "users WHERE `last_30d_spend_vnd ≥ 5_000_000`", unit: "boolean", domain: "revenue", trust: "certified", synonyms: ["big spenders", "vip", "cá voi"], sampleQuestions: ["Whale count in VN", "Whale ARPPU"], owner: "minh", refreshMinutes: 14, refreshSla: 60, usedIn: { dashboards: 7, mcp: 3, cdp: 9, savedViews: 18 } },
  { id: "seg.dolphins", type: "segment", cube: "users", member: "dolphins", label: "Dolphins", description: "Users with 500K–5M VND spend in 30d.", formulaText: "users WHERE `last_30d_spend_vnd BETWEEN 500_000 AND 5_000_000`", unit: "boolean", domain: "revenue", trust: "certified", owner: "minh", refreshMinutes: 14, refreshSla: 60, usedIn: { dashboards: 5, mcp: 1, cdp: 6, savedViews: 9 } },
  { id: "seg.minnows", type: "segment", cube: "users", member: "minnows", label: "Minnows", description: "Users with < 500K VND spend in 30d.", formulaText: "users WHERE `last_30d_spend_vnd < 500_000`", unit: "boolean", domain: "revenue", trust: "certified", owner: "minh", refreshMinutes: 14, refreshSla: 60, usedIn: { dashboards: 4, mcp: 1, cdp: 4, savedViews: 6 } },
  { id: "seg.lapsed_payer_14d", type: "segment", cube: "users", member: "lapsed_payer_14d", label: "Lapsed Payer (14d)", description: "Was a payer, no purchase in last 14 days. Ideal re-engagement audience.", formulaText: "users WHERE `was_payer = true AND last_payment_at < today - 14d`", unit: "boolean", domain: "retention", trust: "certified", synonyms: ["churned payer", "winback"], sampleQuestions: ["Size of lapsed_payer_14d", "Lapsed by tier"], owner: "minh", refreshMinutes: 22, refreshSla: 60, usedIn: { dashboards: 3, mcp: 2, cdp: 5, savedViews: 7 } },
  { id: "seg.first_time_payer_30d", type: "segment", cube: "users", member: "ftp_30d", label: "First-time Payer (30d)", description: "First payment in last 30 days. Onboarding cohort.", formulaText: "users WHERE `first_payment_at ≥ today - 30d`", unit: "boolean", domain: "revenue", trust: "beta", owner: "tuan", refreshMinutes: 22, refreshSla: 60, usedIn: { dashboards: 2, mcp: 0, cdp: 3, savedViews: 4 } },
  { id: "seg.vn_only", type: "segment", cube: "users", member: "vn_only", label: "Vietnam Only", description: "country = 'VN'. Convenience segment for the core market.", formulaText: "users WHERE `country = 'VN'`", unit: "boolean", domain: "acquisition", trust: "certified", owner: "ngan", refreshMinutes: 12, refreshSla: 60, usedIn: { dashboards: 28, mcp: 4, cdp: 14, savedViews: 32 } },
];

// Activity feed for Metric Detail
const ACTIVITY = [
  { id: 1, type: "edit",     actor: "linh", at: "2026-05-18 14:22", text: "Updated description: '… Excludes refunds and chargebacks.'" },
  { id: 2, type: "feedback", actor: "minh", at: "2026-05-17 09:08", verdict: "up", text: "Crystal clear — used in today's campaign brief." },
  { id: 3, type: "save",     actor: "tuan", at: "2026-05-16 16:41", text: "Saved view 'VN whales — revenue WoW'." },
  { id: 4, type: "feedback", actor: "hieu", at: "2026-05-15 11:00", verdict: "down", text: "Should clarify timezone — is this UTC or VN local?" },
  { id: 5, type: "publish",  actor: "linh", at: "2026-05-12 10:33", text: "Promoted from Beta to Certified." },
];

// Saved views (for the user)
const SAVED_VIEWS = [
  { id: "v.vn_whales_wow", name: "VN whales — revenue WoW", owner: "minh", lastRun: "2 hours ago", measures: ["revenue.total_vnd"], dimensions: ["dim.day"], filters: ["seg.whales", "seg.vn_only"], comparison: "vs last 7d" },
  { id: "v.dau_by_country", name: "DAU by country (top 5)", owner: "linh", lastRun: "yesterday", measures: ["users.dau"], dimensions: ["dim.country"], filters: [], limit: 5 },
  { id: "v.arppu_drift", name: "ARPPU drift watch", owner: "linh", lastRun: "3 days ago", measures: ["revenue.arppu_vnd"], dimensions: ["dim.day"], filters: [] },
  { id: "v.lapsed_winback", name: "Lapsed payer winback audience", owner: "minh", lastRun: "5 hours ago", measures: ["users.paying_users"], dimensions: ["dim.payer_tier"], filters: ["seg.lapsed_payer_14d", "seg.vn_only"] },
];

// Notifications
const NOTIFICATIONS = [
  { id: 1, type: "anomaly",  ts: "12 min ago", title: "Refund Rate is anomalous (+154%)", concept: "payments.refund_rate", state: "high" },
  { id: 2, type: "anomaly",  ts: "2 hours ago", title: "30-day Churn trending up", concept: "users.churn_30d", state: "trend" },
  { id: 3, type: "edit",     ts: "yesterday", title: "Linh Pham edited 'Paying Users'", concept: "users.paying_users" },
  { id: 4, type: "feedback", ts: "yesterday", title: "Hieu Dang left feedback on Revenue (VND)", concept: "revenue.total_vnd" },
  { id: 5, type: "digest",   ts: "2 days ago", title: "Weekly digest: 5 metrics tracked", concept: null },
];

// Lineage graph for revenue.total_vnd
const LINEAGE = {
  "revenue.total_vnd": {
    upstream: [
      { id: "wh.payments", type: "warehouse_table", label: "warehouse.public.payments", meta: "rows · 412M / refreshed 8m" },
      { id: "cube.revenue", type: "cube", label: "revenue", meta: "Cube YAML" },
    ],
    downstream: [
      { id: "view.vn_whales_wow", type: "saved_view",  label: "VN whales — revenue WoW", meta: "by Minh" },
      { id: "dash.exec_overview", type: "dashboard",   label: "Exec overview (Looker)", meta: "external" },
      { id: "dash.finance_mtd",   type: "dashboard",   label: "Finance MTD", meta: "Tableau" },
      { id: "mcp.revenue_alerts", type: "mcp_tool",    label: "revenue_alerts (MCP)", meta: "agentic tool" },
      { id: "cdp.lapsed_payer",   type: "cdp_audience",label: "lapsed_payer_14d (CDP)", meta: "Segment.com" },
    ],
    composed: [
      { id: "revenue.arppu_vnd", label: "ARPPU (VND) = revenue.total_vnd / users.paying_users" },
      { id: "revenue.arpu_vnd",  label: "ARPU (VND) = revenue.total_vnd / users.dau" },
    ],
  },
};

// "Why did revenue move?" — for change analysis modal
const CHANGE_ANALYSIS = {
  "revenue.total_vnd": {
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

// Quick lookup
const CONCEPT_BY_ID = Object.fromEntries(CONCEPTS.map(c => [c.id, c]));
const CONCEPT_BY_REF = Object.fromEntries(CONCEPTS.map(c => [`${c.cube}.${c.member}`, c]));

Object.assign(window, { OWNERS, CONCEPTS, CONCEPT_BY_ID, CONCEPT_BY_REF, ACTIVITY, SAVED_VIEWS, NOTIFICATIONS, LINEAGE, CHANGE_ANALYSIS });
