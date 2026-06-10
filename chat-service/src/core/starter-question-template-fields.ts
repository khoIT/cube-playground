/**
 * Field-segment name lists shared between the template engine and any
 * game-specific template extensions. Each list covers the bare member name
 * across cube generations (local game_id names vs prod prefixed names are
 * resolved by MemberIndex field-segment matching, so only the bare segment
 * is needed here).
 *
 * Consumed by starter-question-templates.ts.
 */

export const LTV_FIELDS = ['ltv_total_vnd', 'ltv_vnd', 'total_recharge_vnd', 'revenue_vnd'];

/** Revenue measure names across user_recharge_daily and legacy recharge cubes. */
export const REVENUE_FIELDS = ['revenue_vnd_total', 'revenue_vnd', 'rev'];

// Economy (diamond/currency flow) — etl_money_flow.
export const ECONOMY_SPEND_FIELDS = ['out_events', 'diamond_out_events'];
export const ECONOMY_DELTA_FIELDS = ['total_delta', 'net_delta'];
export const ECONOMY_SPENDER_FIELDS = ['distinct_players', 'spender_count'];

// Gacha / lottery pulls — etl_lottery_shoot.
export const GACHA_PULL_FIELDS = ['pulls', 'pull_count', 'total_pulls'];
export const GACHA_DIAMOND_FIELDS = ['total_cost_diamond', 'diamond_cost'];

// Tutorial / onboarding funnel — etl_newbie_tutorial.
export const TUTORIAL_RATE_FIELDS = ['completion_rate', 'tutorial_completion_rate'];
export const TUTORIAL_COMPLETED_FIELDS = ['completed_count', 'tutorial_completions'];
export const TUTORIAL_STARTED_FIELDS = ['started_count', 'tutorial_starters'];

// Paying-user retention — new_user_retention.
export const PAYING_RETENTION_FIELDS = ['rpnpu_d7', 'rpnpu_d30'];
