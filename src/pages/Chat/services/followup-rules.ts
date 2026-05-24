/**
 * Deterministic rules for suggested follow-up chips (phase-04).
 *
 * Each rule fires when at least one trigger condition matches the most
 * recent assistant turn — cubes touched (from query_artifact sources) or
 * tool names invoked. Returns a list of natural-language suggestions
 * that the chat composer can prefill.
 *
 * No LLM call required; client-side only. The chip pool is intentionally
 * curated so a 100-turn QA session surfaces ≥5 distinct ids (phase-04
 * success criteria diversity gate).
 */

export interface FollowupRule {
  id: string;
  /** Cube prefixes (e.g. `players`, `orders`) that arm this rule. */
  cubeAny?: ReadonlyArray<string>;
  /** Tool names — any match arms the rule. */
  toolAny?: ReadonlyArray<string>;
  /** Suggestions emitted when the rule fires. */
  suggestions: ReadonlyArray<string>;
}

export const FOLLOWUP_RULES: ReadonlyArray<FollowupRule> = [
  {
    id: 'segment-created',
    toolAny: ['emit_query_artifact', 'create_segment'],
    suggestions: [
      'Save this as a monitored segment',
      'Show 10 sample members',
      'Compare size by country',
    ],
  },
  {
    id: 'retention-drilldown',
    cubeAny: ['retention', 'players_retention'],
    suggestions: [
      'Show D7 retention by install cohort',
      'Compare retention curve to last month',
      'Which cohorts dropped the most?',
    ],
  },
  {
    id: 'revenue-drilldown',
    cubeAny: ['orders', 'transactions', 'revenue'],
    suggestions: [
      'Break down revenue by country',
      'Compare revenue to last week',
      'Show top 10 spending players',
    ],
  },
  {
    id: 'players-explore',
    cubeAny: ['players', 'users'],
    suggestions: [
      'Break down DAU by platform',
      'Show 30-day DAU trend',
      'Compare DAU to last week',
    ],
  },
  {
    id: 'campaign-explore',
    cubeAny: ['campaigns', 'acquisition'],
    suggestions: [
      'Compare ROAS by channel',
      'Show CPI trend last 7 days',
      'Top 10 campaigns by install volume',
    ],
  },
  {
    id: 'metric-explain',
    toolAny: ['get_business_metric'],
    suggestions: [
      'Show me the trend for this metric',
      'How is this measured?',
      'Compare it across cohorts',
    ],
  },
  {
    id: 'sql-preview',
    toolAny: ['explain_cube_sql', 'preview_cube_query'],
    suggestions: [
      'Run this query on last 30 days',
      'Add a country breakdown',
      'Show me the result as a chart',
    ],
  },
  {
    id: 'diagnose-drop',
    toolAny: ['diagnose'],
    suggestions: [
      'Drill into the country with the biggest drop',
      'Compare to the same window last month',
      'Show me the suspect cohort',
    ],
  },
];

export const FOLLOWUP_FALLBACK: ReadonlyArray<string> = [
  'Show me daily revenue last 7 days',
  'Compare ARPDAU month-over-month',
  'Why did engagement drop this week?',
];
