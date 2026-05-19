// Cube schema + segments + user records.
// 4 cubes: mf_users (hub) · active_daily · user_recharge_daily · recharge
// Hub-and-spoke joins on mf_users.user_id.

const CUBES = [
  {
    name: 'mf_users',
    grain: '1 row / user',
    icon: 'circle-user-round',
    description: 'Hub. Lifetime per-user attributes — country, channel, tier, anchor dates.',
    members: 21,
    measures: 6,
    dimensions: 12,
    segments: 7,
  },
  {
    name: 'active_daily',
    grain: '1 row / user / active day',
    icon: 'calendar-clock',
    description: 'Daily activity rollup. Sourced from session events.',
    members: 7,
    measures: 3,
    dimensions: 4,
    segments: 0,
  },
  {
    name: 'user_recharge_daily',
    grain: '1 row / user / recharge day',
    icon: 'wallet',
    description: 'Daily payment rollup per user.',
    members: 5,
    measures: 3,
    dimensions: 2,
    segments: 0,
  },
  {
    name: 'recharge',
    grain: '1 row / transaction',
    icon: 'receipt',
    description: 'Raw payment events. Use when you need txn-level attributes (method, role).',
    members: 6,
    measures: 3,
    dimensions: 3,
    segments: 0,
  },
];

// ─── Saved segments mock ───
const SEGMENTS = [
  {
    id: 'seg.whales_vn',
    name: 'Whales · Vietnam',
    description: 'Lifetime spend ≥ 5M VND and country = VN.',
    owner: 'minh',
    avatar: '#f59e0b',
    updated: '2 hours ago',
    size: 8420,
    sizeDelta: 0.034,
    live: true,
    refresh: '15m',
    nextRefresh: '00:08:24',
    cube: 'mf_users',
    tags: ['revenue', 'vip'],
    usedIn: { dashboards: 7, mcp: 3, savedViews: 18 },
    sparkline: [7900, 7980, 8000, 8050, 8090, 8120, 8180, 8210, 8260, 8300, 8340, 8380, 8410, 8420],
    predicate: {
      kind: 'AND',
      children: [
        { kind: 'leaf', column: 'mf_users.lifetime_revenue_vnd', op: '>=', value: '5000000', type: 'number' },
        { kind: 'leaf', column: 'mf_users.country', op: '=', value: 'VN', type: 'string' },
      ],
    },
  },
  {
    id: 'seg.lapsed_payer_14d',
    name: 'Lapsed payer · 14d',
    description: 'Was a payer; no purchase in last 14 days. Winback target.',
    owner: 'minh',
    avatar: '#9333ea',
    updated: 'yesterday',
    size: 14210,
    sizeDelta: 0.087,
    live: true,
    refresh: '1h',
    nextRefresh: '00:42:11',
    cube: 'mf_users',
    tags: ['retention', 'winback'],
    usedIn: { dashboards: 3, mcp: 2, savedViews: 7 },
    sparkline: [13200, 13400, 13310, 13500, 13620, 13780, 13900, 13980, 14040, 14100, 14160, 14200, 14210, 14210],
    predicate: {
      kind: 'AND',
      children: [
        { kind: 'leaf', column: 'mf_users.was_payer', op: '=', value: 'true', type: 'boolean' },
        { kind: 'leaf', column: 'mf_users.days_since_last_payment', op: '>', value: '14', type: 'number' },
      ],
    },
  },
  {
    id: 'seg.first_time_payer_30d',
    name: 'First-time payer · 30d',
    description: 'First successful payment within the last 30 days.',
    owner: 'tuan',
    avatar: '#3f8dff',
    updated: '4 hours ago',
    size: 2310,
    sizeDelta: 0.142,
    live: true,
    refresh: '6h',
    nextRefresh: '03:14:09',
    cube: 'mf_users',
    tags: ['revenue', 'cohort'],
    usedIn: { dashboards: 2, mcp: 0, savedViews: 4 },
    sparkline: [1800, 1850, 1880, 1920, 1980, 2020, 2070, 2120, 2160, 2200, 2240, 2270, 2290, 2310],
    predicate: {
      kind: 'AND',
      children: [
        { kind: 'leaf', column: 'mf_users.first_recharge_date', op: 'inDateRange', value: 'last 30 days', type: 'time' },
      ],
    },
  },
  {
    id: 'seg.dolphins',
    name: 'Dolphins',
    description: '500K–5M VND lifetime spend.',
    owner: 'minh',
    avatar: '#0891b2',
    updated: '3 days ago',
    size: 31920,
    sizeDelta: 0.011,
    live: false,
    refresh: '—',
    cube: 'mf_users',
    tags: ['revenue'],
    usedIn: { dashboards: 5, mcp: 1, savedViews: 9 },
    sparkline: [31000, 31100, 31200, 31300, 31400, 31500, 31600, 31700, 31750, 31800, 31850, 31880, 31900, 31920],
    predicate: {
      kind: 'AND',
      children: [
        { kind: 'leaf', column: 'mf_users.lifetime_revenue_vnd', op: '>=', value: '500000', type: 'number' },
        { kind: 'leaf', column: 'mf_users.lifetime_revenue_vnd', op: '<', value: '5000000', type: 'number' },
      ],
    },
  },
  {
    id: 'seg.android_paid_vn',
    name: 'Android · Paid install · VN',
    description: 'Android installs attributed to paid media in Vietnam.',
    owner: 'tuan',
    avatar: '#10b981',
    updated: '6 days ago',
    size: 124800,
    sizeDelta: -0.012,
    live: true,
    refresh: '24h',
    nextRefresh: '11:02:00',
    cube: 'mf_users',
    tags: ['acquisition'],
    usedIn: { dashboards: 4, mcp: 0, savedViews: 6 },
    sparkline: [126000, 125800, 125400, 125200, 125000, 125100, 125000, 124900, 124850, 124800, 124820, 124810, 124800, 124800],
    predicate: {
      kind: 'AND',
      children: [
        { kind: 'leaf', column: 'mf_users.platform', op: '=', value: 'android', type: 'string' },
        { kind: 'leaf', column: 'mf_users.country', op: '=', value: 'VN', type: 'string' },
        { kind: 'leaf', column: 'mf_users.channel', op: 'IN', value: 'facebook_ads,google_ads,tiktok', type: 'string' },
      ],
    },
  },
  {
    id: 'seg.ad_hoc_2305',
    name: 'Ad-hoc · 23 May export',
    description: 'Pushed from Playground · QA cohort for retention test.',
    owner: 'linh',
    avatar: '#ef4444',
    updated: 'just now',
    size: 47,
    sizeDelta: null,
    live: false,
    refresh: '—',
    cube: 'mf_users',
    tags: ['ad-hoc'],
    usedIn: { dashboards: 0, mcp: 0, savedViews: 1 },
    sparkline: [47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47],
    predicate: null, // static uid list
  },
];

// ─── Sample users for the Results table on Playground ───
// 12 rows, mf_users + active_daily joined on user_id.
const RESULTS_ROWS = [
  { user_id: 'u_8e2a91', country: 'VN', channel: 'facebook_ads', platform: 'android', payer_tier: 'whale', arpu_vnd: 11_240_000, last_active: '2026-05-18', first_recharge: '2025-09-14' },
  { user_id: 'u_4c81f0', country: 'VN', channel: 'organic', platform: 'ios', payer_tier: 'whale', arpu_vnd: 8_420_000, last_active: '2026-05-19', first_recharge: '2025-04-02' },
  { user_id: 'u_71a3bc', country: 'TH', channel: 'google_ads', platform: 'android', payer_tier: 'dolphin', arpu_vnd: 1_980_000, last_active: '2026-05-17', first_recharge: '2026-01-21' },
  { user_id: 'u_9f0c42', country: 'VN', channel: 'organic', platform: 'android', payer_tier: 'whale', arpu_vnd: 14_780_000, last_active: '2026-05-19', first_recharge: '2024-12-08' },
  { user_id: 'u_2d6e88', country: 'ID', channel: 'tiktok', platform: 'ios', payer_tier: 'minnow', arpu_vnd: 320_000, last_active: '2026-05-15', first_recharge: '2026-04-03' },
  { user_id: 'u_b3145e', country: 'VN', channel: 'facebook_ads', platform: 'android', payer_tier: 'whale', arpu_vnd: 6_410_000, last_active: '2026-05-18', first_recharge: '2025-11-22' },
  { user_id: 'u_aa9210', country: 'VN', channel: 'cross_promo', platform: 'ios', payer_tier: 'dolphin', arpu_vnd: 2_140_000, last_active: '2026-05-19', first_recharge: '2025-08-30' },
  { user_id: 'u_5e7019', country: 'PH', channel: 'organic', platform: 'web', payer_tier: 'non_payer', arpu_vnd: 0, last_active: '2026-05-16', first_recharge: null },
  { user_id: 'u_c421a7', country: 'VN', channel: 'influencer', platform: 'android', payer_tier: 'whale', arpu_vnd: 9_360_000, last_active: '2026-05-19', first_recharge: '2025-07-11' },
  { user_id: 'u_0f8332', country: 'MY', channel: 'google_ads', platform: 'ios', payer_tier: 'minnow', arpu_vnd: 410_000, last_active: '2026-05-14', first_recharge: '2026-03-18' },
  { user_id: 'u_d61bf2', country: 'VN', channel: 'organic', platform: 'android', payer_tier: 'whale', arpu_vnd: 7_220_000, last_active: '2026-05-19', first_recharge: '2025-05-04' },
  { user_id: 'u_6a93cd', country: 'TH', channel: 'facebook_ads', platform: 'ios', payer_tier: 'dolphin', arpu_vnd: 1_540_000, last_active: '2026-05-18', first_recharge: '2026-02-09' },
];

// ─── Detailed breakdown for the focused segment (Whales · Vietnam) ───
// Numbers are computed against the 4 cubes by the (mock) Cube engine.
const SEGMENT_DETAIL = {
  id: 'seg.whales_vn',
  identity: {
    // mf_users dimensions
    country: [
      { label: 'VN', value: 8420, pct: 1.0, color: 'var(--brand)' },
    ],
    channel: [
      { label: 'organic', value: 3260, pct: 0.387 },
      { label: 'facebook_ads', value: 2440, pct: 0.290 },
      { label: 'google_ads', value: 1180, pct: 0.140 },
      { label: 'tiktok', value: 820, pct: 0.097 },
      { label: 'cross_promo', value: 480, pct: 0.057 },
      { label: 'influencer', value: 240, pct: 0.028 },
    ],
    platform: [
      { label: 'android', value: 5630, pct: 0.669 },
      { label: 'ios', value: 2530, pct: 0.300 },
      { label: 'web', value: 260, pct: 0.031 },
    ],
    payer_tier: [
      { label: 'whale', value: 8420, pct: 1.0 },
    ],
  },
  engagement: {
    // active_daily measures
    dau_14d: [
      { d: 'May 06', dau: 4120 }, { d: 'May 07', dau: 4180 }, { d: 'May 08', dau: 4220 },
      { d: 'May 09', dau: 4310 }, { d: 'May 10', dau: 4380 }, { d: 'May 11', dau: 4290 },
      { d: 'May 12', dau: 4250 }, { d: 'May 13', dau: 4330 }, { d: 'May 14', dau: 4420 },
      { d: 'May 15', dau: 4480 }, { d: 'May 16', dau: 4510 }, { d: 'May 17', dau: 4460 },
      { d: 'May 18', dau: 4540 }, { d: 'May 19', dau: 4620 },
    ],
    stickiness: 0.548, // DAU / MAU
    avg_sessions_per_user_30d: 14.2,
    mau_30d: 8420,
  },
  monetization: {
    // user_recharge_daily + recharge
    revenue_30d_vnd: 184_320_000_000,
    revenue_30d_delta: 0.082,
    arpu_vnd: 21_890_000,
    arppu_vnd: 21_890_000, // every whale is paying
    paying_rate: 1.0,
    revenue_14d: [
      { d: 'May 06', vnd: 5800 }, { d: 'May 07', vnd: 5920 }, { d: 'May 08', vnd: 6010 },
      { d: 'May 09', vnd: 6240 }, { d: 'May 10', vnd: 6480 }, { d: 'May 11', vnd: 6320 },
      { d: 'May 12', vnd: 6190 }, { d: 'May 13', vnd: 6410 }, { d: 'May 14', vnd: 6620 },
      { d: 'May 15', vnd: 6840 }, { d: 'May 16', vnd: 7010 }, { d: 'May 17', vnd: 6890 },
      { d: 'May 18', vnd: 7220 }, { d: 'May 19', vnd: 7480 },
    ],
    payment_method: [
      { label: 'momo', value: 0.342, vnd: 63_037_000_000 },
      { label: 'zing_card', value: 0.281, vnd: 51_793_000_000 },
      { label: 'iap_ios', value: 0.218, vnd: 40_182_000_000 },
      { label: 'iap_android', value: 0.114, vnd: 21_012_000_000 },
      { label: 'bank', value: 0.045, vnd: 8_296_000_000 },
    ],
  },
  retention: {
    // first_active_date cohort retention — days since join
    curve: [
      { day: 'D0', pct: 1.0 }, { day: 'D1', pct: 0.94 }, { day: 'D3', pct: 0.88 },
      { day: 'D7', pct: 0.81 }, { day: 'D14', pct: 0.74 }, { day: 'D30', pct: 0.68 },
      { day: 'D60', pct: 0.62 }, { day: 'D90', pct: 0.58 },
    ],
    first_active_buckets: [
      { label: '2024', value: 2810 },
      { label: '2025 H1', value: 2380 },
      { label: '2025 H2', value: 1940 },
      { label: '2026 YTD', value: 1290 },
    ],
    days_since_first_recharge_median: 187,
    days_since_first_active_median: 312,
  },
  sample_users: [
    { user_id: 'u_8e2a91', country: 'VN', channel: 'facebook_ads', platform: 'android', arpu_vnd: 11_240_000, last_active: '2026-05-18', first_recharge: '2025-09-14' },
    { user_id: 'u_4c81f0', country: 'VN', channel: 'organic',      platform: 'ios',     arpu_vnd:  8_420_000, last_active: '2026-05-19', first_recharge: '2025-04-02' },
    { user_id: 'u_9f0c42', country: 'VN', channel: 'organic',      platform: 'android', arpu_vnd: 14_780_000, last_active: '2026-05-19', first_recharge: '2024-12-08' },
    { user_id: 'u_b3145e', country: 'VN', channel: 'facebook_ads', platform: 'android', arpu_vnd:  6_410_000, last_active: '2026-05-18', first_recharge: '2025-11-22' },
    { user_id: 'u_c421a7', country: 'VN', channel: 'influencer',   platform: 'android', arpu_vnd:  9_360_000, last_active: '2026-05-19', first_recharge: '2025-07-11' },
    { user_id: 'u_d61bf2', country: 'VN', channel: 'organic',      platform: 'android', arpu_vnd:  7_220_000, last_active: '2026-05-19', first_recharge: '2025-05-04' },
    { user_id: 'u_3a17e0', country: 'VN', channel: 'google_ads',   platform: 'android', arpu_vnd: 12_910_000, last_active: '2026-05-19', first_recharge: '2025-03-19' },
    { user_id: 'u_2bc449', country: 'VN', channel: 'tiktok',       platform: 'ios',     arpu_vnd:  5_840_000, last_active: '2026-05-19', first_recharge: '2025-12-02' },
  ],
};

// Operator catalogue for the predicate editor.
const OPERATORS = {
  string: [
    { id: '=', label: 'equals' },
    { id: '!=', label: 'does not equal' },
    { id: 'IN', label: 'is one of' },
    { id: 'NOT IN', label: 'is not one of' },
    { id: 'contains', label: 'contains' },
    { id: 'set', label: 'is set' },
    { id: 'notSet', label: 'is not set' },
  ],
  number: [
    { id: '=', label: 'equals' },
    { id: '!=', label: 'does not equal' },
    { id: '>', label: 'greater than' },
    { id: '>=', label: 'at least' },
    { id: '<', label: 'less than' },
    { id: '<=', label: 'at most' },
    { id: 'between', label: 'between' },
  ],
  time: [
    { id: 'inDateRange', label: 'in date range' },
    { id: 'beforeDate', label: 'before' },
    { id: 'afterDate', label: 'after' },
  ],
  boolean: [
    { id: '=', label: 'is' },
  ],
};

// Columns from mf_users that are most useful in a predicate (the hub).
const HUB_COLUMNS = [
  { id: 'mf_users.country',              type: 'string',  label: 'Country' },
  { id: 'mf_users.channel',              type: 'string',  label: 'Channel' },
  { id: 'mf_users.platform',             type: 'string',  label: 'Platform' },
  { id: 'mf_users.payer_tier',           type: 'string',  label: 'Payer tier' },
  { id: 'mf_users.lifetime_revenue_vnd', type: 'number',  label: 'Lifetime revenue (VND)' },
  { id: 'mf_users.first_active_date',    type: 'time',    label: 'First active date' },
  { id: 'mf_users.first_recharge_date',  type: 'time',    label: 'First recharge date' },
  { id: 'mf_users.install_date',         type: 'time',    label: 'Install date' },
  { id: 'mf_users.was_payer',            type: 'boolean', label: 'Was payer' },
  { id: 'mf_users.days_since_last_payment', type: 'number', label: 'Days since last payment' },
];

Object.assign(window, {
  CUBES, SEGMENTS, RESULTS_ROWS, SEGMENT_DETAIL, OPERATORS, HUB_COLUMNS,
});
