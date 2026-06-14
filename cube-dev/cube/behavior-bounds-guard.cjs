// Behavior / high-volume scan guardrail (ported from prod kraken/cube cube.js).
//
// Any query touching a raw event-stream cube (bare `etl_*`), a view that fronts
// one, OR a high-volume transaction cube MUST bound time via
// log_date / dteventtime / ts / order_date — a timeDimensions dateRange, an
// inDateRange filter, or a recognised short-window segment — and the span MUST
// be <= MAX_RANGE_DAYS. Raw event tables sit at 1M–1.3B rows on Trino and the
// billing transaction table at ~58.6M rows; an unbounded scan OOMs the
// coordinator. Local cubes are bare-named (the compile is per-game), so the
// prefixed kraken form `<game>_etl_*` becomes the bare `etl_*` here.
//
// Extracted from cube.js so the pure logic is unit-testable without the JWT /
// auth-DB request machinery. cube.js requires this module and calls
// enforceBehaviorBounds() from queryRewrite.

const MAX_RANGE_DAYS = 31;

const BEHAVIOR_VIEWS = new Set([
  // cfm FPS event panels
  'user_matches_panel',
  'user_team_starts_panel',
  'user_money_flow_panel',
  'user_lottery_panel',
  'user_tutorial_panel',
  'user_newbie_detail_panel',
  'user_game_detail_panel',
  'user_prop_flow_panel',
  // shared login/logout/register session panels (cfm + cros + tf)
  'user_login_panel',
  'user_logout_panel',
  'user_register_panel',
  // UNION of raw etl_ingame_* event tables behind a window function — an
  // unbounded query full-scans every event partition, so it needs the same
  // bound as the raw cubes it fronts (its time dimension is `ts`).
  'ordered_event_funnel',
]);

// High-volume transaction cubes/views that are NOT etl_* event streams but are
// still large enough that an unbounded scan is unsafe. The payment-gateway
// billing detail cube is txn-grain (~58.6M rows); its time dimension is
// `order_date`. Both the bare cube and its 360 panel view are guarded so a
// direct Catalog/Playground query and a member360 query both require a bound.
const BIG_TXN_VIEWS = new Set([
  'billing_detail',
  'user_billing_detail_panel',
]);

const TIME_DIM_FIELDS = new Set(['log_date', 'dteventtime', 'ts', 'order_date']);
const SAFE_SEGMENT_DAYS = { last_7d: 7, last_30d: 30 };

// Bare event-stream cube: `etl_<something>`. (Prefixed `<game>_etl_*` also matched
// for safety in case a non-bare reference slips through.)
const isBehaviorRawCube = (name) =>
  typeof name === 'string' && /^(?:[a-z][a-z0-9]*_)?etl_[a-z0-9_]+$/.test(name);

const isGuarded = (cube) =>
  BEHAVIOR_VIEWS.has(cube) || BIG_TXN_VIEWS.has(cube) || isBehaviorRawCube(cube);

const memberPrefix = (m) => {
  if (typeof m !== 'string') return null;
  const i = m.indexOf('.');
  return i > 0 ? m.slice(0, i) : null;
};
const memberSuffix = (m) => {
  if (typeof m !== 'string') return null;
  const i = m.indexOf('.');
  return i > 0 ? m.slice(i + 1) : null;
};

const walkFilters = (node, visit) => {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach((n) => walkFilters(n, visit)); return; }
  if (node.member) visit(node);
  if (node.and) walkFilters(node.and, visit);
  if (node.or) walkFilters(node.or, visit);
};

const collectCubesTouched = (query) => {
  const cubes = new Set();
  const add = (m) => { const p = memberPrefix(m); if (p) cubes.add(p); };
  (query.measures || []).forEach(add);
  (query.dimensions || []).forEach(add);
  (query.segments || []).forEach(add);
  (query.timeDimensions || []).forEach((t) => t && add(t.dimension));
  walkFilters(query.filters, (n) => add(n.member));
  return cubes;
};

const parseDateRangeDays = (dateRange) => {
  if (Array.isArray(dateRange) && dateRange.length === 2) {
    const from = new Date(dateRange[0]);
    const to = new Date(dateRange[1]);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    const days = Math.floor((to - from) / 86400000) + 1;
    // Fail closed on a non-positive / reversed range — treat as unbounded.
    return days > 0 ? days : null;
  }
  if (typeof dateRange !== 'string') return null;
  const s = dateRange.trim().toLowerCase();
  const m = s.match(/^last\s+(\d+)\s+day/);
  if (m) return parseInt(m[1], 10);
  if (s === 'today' || s === 'yesterday') return 1;
  if (s === 'this week' || s === 'last week') return 7;
  if (s === 'this month' || s === 'last month') return 31;
  if (s.includes('quarter')) return 92;
  if (s.includes('year')) return 366;
  return null; // unknown — fail closed
};

const collectBoundDays = (query, cube) => {
  const days = [];
  for (const t of query.timeDimensions || []) {
    if (!t || !t.dimension || !t.dateRange) continue;
    if (memberPrefix(t.dimension) !== cube) continue;
    if (!TIME_DIM_FIELDS.has(memberSuffix(t.dimension))) continue;
    const d = parseDateRangeDays(t.dateRange);
    if (d != null) days.push(d);
  }
  walkFilters(query.filters, (n) => {
    if (memberPrefix(n.member) !== cube) return;
    if (!TIME_DIM_FIELDS.has(memberSuffix(n.member))) return;
    if (n.operator !== 'inDateRange') return;
    const d = parseDateRangeDays(n.values);
    if (d != null) days.push(d);
  });
  for (const seg of query.segments || []) {
    if (memberPrefix(seg) !== cube) continue;
    if (SAFE_SEGMENT_DAYS[memberSuffix(seg)] != null) days.push(SAFE_SEGMENT_DAYS[memberSuffix(seg)]);
  }
  return days;
};

// Enforce: every guarded cube/view touched by the query must be bounded to a
// <= MAX_RANGE_DAYS window. Throws (rejecting the query) otherwise.
const enforceBehaviorBounds = (query) => {
  const touched = [...collectCubesTouched(query)].filter(isGuarded);
  for (const cube of touched) {
    const days = collectBoundDays(query, cube);
    if (days.length === 0) {
      throw new Error(
        `Query on high-volume cube/view "${cube}" must bound ` +
        `log_date/dteventtime/ts/order_date (dateRange, inDateRange, or a ` +
        `last_7d/last_30d segment) within ${MAX_RANGE_DAYS} days.`,
      );
    }
    const span = Math.max(...days);
    if (span > MAX_RANGE_DAYS) {
      throw new Error(
        `Query on high-volume cube/view "${cube}" spans ${span} days; max ${MAX_RANGE_DAYS}.`,
      );
    }
  }
};

module.exports = {
  MAX_RANGE_DAYS,
  BEHAVIOR_VIEWS,
  BIG_TXN_VIEWS,
  TIME_DIM_FIELDS,
  isBehaviorRawCube,
  isGuarded,
  enforceBehaviorBounds,
};
