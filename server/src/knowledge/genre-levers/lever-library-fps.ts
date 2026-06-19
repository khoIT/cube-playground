/**
 * Competitive-FPS lever library (cfm_vn = CrossFire Mobile).
 *
 * Levers reflect how a tactical-shooter F2P title actually retains and
 * monetizes: clan social bonds, competitive integrity (rank spirals +
 * cheating), skin/crate FOMO, battle-pass attach, and cause-typed whale care.
 *
 * External norms below are DRAFTED for analyst verification — every figure
 * carries a `source` + `citation`. Values use widely-cited F2P/shooter
 * benchmark ranges; treat as starting points, not gospel.
 *
 * Data-gate honesty: cfm has clan flags (user_gameplay_daily) and gacha
 * (etl_lottery_shoot), so those levers resolve. Cheating is the genre's #1
 * churn driver but is NOT in our data — encoded as a blind spot, surfaced
 * never fabricated.
 */

import type { GenreLever } from './lever-types.js';

export const FPS_LEVERS: GenreLever[] = [
  {
    id: 'fps-clan-social-retention',
    genreTags: ['competitive-fps'],
    games: [], // genre-wide: any FPS with clan data
    lever: 'Clan social retention',
    signal: 'Clan membership shrinking or clan_left rising — social bonds breaking',
    requiredCubes: [
      'user_gameplay_daily.clan_id',
      'user_gameplay_daily.clan_left_at',
      'user_gameplay_daily.clan_changed_at',
    ],
    benchmark: {
      metricKey: 'clan_member_share',
      internalPercentileBand: 'p50',
      externalNorm: {
        value: 2.5,
        unit: 'ratio',
        direction: 'higher-better',
        source: 'Industry consensus (guild/clan retention studies)',
        citation:
          'Clan/guild members typically retain ~2–3× longer than soloists in social-competitive titles; verify against cfm cohort split.',
      },
    },
    action: {
      text: 'Run a clan event / clan-instability win-back for members who recently left or lost their clan.',
      leverFamily: 'social-retention',
    },
    defaultWrite: 'sweep',
    rationale:
      'In team shooters the clan is the primary social anchor; losing it predicts churn more than a single bad session.',
  },
  {
    id: 'fps-competitive-integrity-rank-drop',
    genreTags: ['competitive-fps'],
    games: [],
    lever: 'Competitive integrity — rank-drop spirals',
    signal: 'Players dropping a ladder tier in a short window (frustration spiral)',
    requiredCubes: [
      'user_gameplay_daily.ladder_level',
      'user_gameplay_daily.ladder_level_prev',
    ],
    benchmark: {
      metricKey: 'rank_drop_rate',
      internalPercentileBand: 'p75',
      externalNorm: {
        value: 10,
        unit: '%',
        direction: 'lower-better',
        source: 'Drafted placeholder — no published norm',
        citation:
          'No reliable external norm for 48h rank-drop rate; rely on internal portfolio percentile. Verify threshold with the competitive team.',
      },
    },
    action: {
      text: 'Offer a rank-protection event or matchmaking review for cohorts in a rapid tier-decline.',
      leverFamily: 'competitive-integrity',
    },
    defaultWrite: 'sweep',
    rationale:
      'Rank-drop spirals compound: each loss lowers MMR, harder matches follow, frustration churns the player.',
  },
  {
    id: 'fps-competitive-integrity-cheating',
    genreTags: ['competitive-fps'],
    games: [],
    lever: 'Competitive integrity — cheating / hacking',
    signal: 'Suspected cheating degrading match fairness (the #1 FPS churn driver)',
    requiredCubes: [], // structurally unmeasurable from current data
    benchmark: { metricKey: 'cheating_incidence' },
    action: {
      text:
        'Cannot assess from available data — no anti-cheat / report signal is modelled. Route to the integrity team rather than guessing a cause.',
      leverFamily: 'competitive-integrity',
    },
    defaultWrite: 'none',
    blindSpot: true,
    rationale:
      'Cheating is the top churn driver in competitive shooters, but our cubes carry no anti-cheat or report data — it must be named as a blind spot, never inferred.',
  },
  {
    id: 'fps-skin-crate-fomo',
    genreTags: ['competitive-fps'],
    games: [],
    lever: 'Skin / crate content cadence',
    signal: 'Gacha pull volume or premium-currency spend falling — content drought',
    requiredCubes: ['etl_lottery_shoot.pulls', 'etl_lottery_shoot.distinct_players'],
    benchmark: {
      metricKey: 'gacha_participation_rate',
      internalPercentileBand: 'p50',
      externalNorm: {
        value: 50,
        unit: '%',
        direction: 'higher-better',
        source: 'Deconstructor of Fun / Naavik gacha economy analyses',
        citation:
          'Share of payers engaging crate/gacha varies widely (~30–60%); use as a soft band, verify per cfm banner.',
      },
    },
    action: {
      text: 'Inject a crate/skin event or limited cosmetic drop to lift ARPPU when pull activity sags.',
      leverFamily: 'content-cadence',
    },
    defaultWrite: 'experiment',
    rationale:
      'Shooter monetization is breadth-driven (skins/crates); a desirable-content gap directly suppresses whale ARPPU.',
  },
  {
    id: 'fps-whale-cause-typed-care',
    genreTags: ['competitive-fps'],
    games: [],
    lever: 'Whale care (cause-typed)',
    signal: 'High-LTV players showing inactivity, rank-drop, or clan loss',
    requiredCubes: [
      'mf_users.ltv_vnd',
      'user_gameplay_daily.ladder_level',
      'user_gameplay_daily.clan_left_at',
    ],
    benchmark: {
      metricKey: 'whale_revenue_share',
      internalPercentileBand: 'p50',
      externalNorm: {
        value: 50,
        unit: '%',
        direction: 'higher-better',
        source: 'Swrve / industry whale-concentration reports',
        citation:
          'Top ~1% of payers often drive ~half of F2P revenue; verify cfm top-1% share before acting.',
      },
    },
    action: {
      text:
        'Trigger a cause-matched whale-care play — competitive frustration, social loss, or content drought drive different treatments. Not one generic outreach.',
      leverFamily: 'whale-care',
    },
    defaultWrite: 'case',
    rationale:
      'FPS whales churn for distinct reasons; matching the treatment to the cause is what separates real care from spam.',
  },
  {
    id: 'fps-first-purchase-conversion',
    genreTags: ['competitive-fps'],
    games: [],
    lever: 'First-purchase conversion',
    signal: 'First-time-payer rate falling — entry-offer or price friction',
    requiredCubes: ['mf_users.first_recharge_date', 'mf_users.ltv_vnd'],
    benchmark: {
      metricKey: 'payer_conversion_rate',
      internalPercentileBand: 'p50',
      externalNorm: {
        value: 3,
        unit: '%',
        direction: 'higher-better',
        source: 'Adjust / AppsFlyer mobile-game payer-conversion benchmarks',
        citation:
          'F2P payer conversion commonly sits ~1–5%; verify cfm install→payer rate against this band.',
      },
    },
    action: {
      text: 'Surface a starter pack / first-purchase offer or test entry price points to lift first conversion.',
      mapsToPlaybookIds: ['01'],
      leverFamily: 'monetization-funnel',
    },
    defaultWrite: 'case',
    rationale:
      'The first purchase is the hardest; a compelling entry offer is the highest-leverage monetization lever for new payers.',
  },
];
