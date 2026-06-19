/**
 * Social-MMORPG lever library (jus_vn = wuxia MMORPG).
 *
 * Levers reflect Eastern-MMORPG economics: server-sharded worlds, vertical
 * VIP/role-level progression (pay-to-progress), whale-dependent revenue, and
 * regional/channel monetization. NO clan/gacha/PvP levers — jus_vn has no
 * guild data, fighting_power is null, and there is no gacha cube. Authoring
 * those would fabricate signal the data can't support.
 *
 * One genre-wide GUILD lever is included to demonstrate the data-gate: most
 * MMORPGs treat guild retention as a lever, but jus_vn lacks guild cubes, so
 * the resolver lists it under `withheld` (with the missing cubes) rather than
 * pretending jus has guilds.
 *
 * External norms are DRAFTED for analyst verification (source + citation each).
 */

import type { GenreLever } from './lever-types.js';

export const MMORPG_LEVERS: GenreLever[] = [
  {
    id: 'mmorpg-server-health-merges',
    genreTags: ['social-mmorpg'],
    games: [],
    lever: 'Server health & merges',
    signal: 'Per-server concurrency drifting below (or above) a healthy band',
    requiredCubes: ['ccu_by_server.peak_ccu', 'ccu_by_server.server_id'],
    benchmark: {
      metricKey: 'server_peak_ccu',
      internalPercentileBand: 'p25',
      externalNorm: {
        value: 5000,
        unit: 'count',
        direction: 'higher-better',
        source: 'Drafted operational heuristic',
        citation:
          'No public norm for healthy per-server CCU; depends on world design. Use internal portfolio band; verify floor with the ops team.',
      },
    },
    action: {
      text:
        'Flag under-populated servers for merge (social/matchmaking floor) or over-loaded servers for split; this is an ops decision, not a player-cohort write.',
      leverFamily: 'server-ops',
    },
    defaultWrite: 'none',
    rationale:
      'In sharded MMORPGs an under-populated server starves social play and economy liquidity; merges restore the loop.',
  },
  {
    id: 'mmorpg-vip-tier-thresholds',
    genreTags: ['social-mmorpg'],
    games: [],
    lever: 'VIP-tier thresholds',
    signal: 'Conversion stalling at a VIP threshold — tier benefits mis-priced',
    requiredCubes: ['mf_users.max_vip_level', 'user_recharge_daily.vip_level'],
    benchmark: {
      metricKey: 'vip_conversion_rate',
      internalPercentileBand: 'p50',
      externalNorm: {
        value: 5,
        unit: '%',
        direction: 'higher-better',
        source: 'Naavik / Eastern-MMORPG monetization analyses',
        citation:
          'VIP-tier conversion is title-specific; ~2–8% reaching a meaningful VIP tier is common. Verify jus tier ladder.',
      },
    },
    action: {
      text: 'Tune tier benefits or run a threshold-nudge offer to lift conversion at the stalling VIP step.',
      leverFamily: 'monetization-depth',
    },
    defaultWrite: 'experiment',
    rationale:
      'MMORPG monetization is vertical: VIP tiers gate power/status. The threshold spacing is a direct ARPPU dial.',
  },
  {
    id: 'mmorpg-role-progression-speed',
    genreTags: ['social-mmorpg'],
    games: [],
    lever: 'Role-level progression speed',
    signal: 'Progression pace too fast (early churn) or too slow (grind-gate frustration)',
    requiredCubes: ['user_roles.max_role_level', 'active_daily.max_role_level'],
    benchmark: {
      metricKey: 'median_role_level_day7',
      internalPercentileBand: 'p50',
      externalNorm: {
        value: 0,
        unit: 'count',
        direction: 'higher-better',
        source: 'Drafted placeholder — title-specific',
        citation:
          'Progression curves are bespoke; no external norm. Use internal portfolio band; verify target curve with design.',
      },
    },
    action: {
      text: 'Adjust XP curve / progression-event cadence to hold engagement without diluting monetization gates.',
      leverFamily: 'progression-tuning',
    },
    defaultWrite: 'experiment',
    rationale:
      'Vertical progression IS the core loop; pacing it controls both engagement depth and pay-to-progress pressure.',
  },
  {
    id: 'mmorpg-whale-care',
    genreTags: ['social-mmorpg'],
    games: [],
    lever: 'Whale care (top progression)',
    signal: 'Top-ranked (role-level + LTV) players going inactive',
    requiredCubes: ['user_gameplay_daily.ladder_rank', 'mf_users.ltv_vnd'],
    benchmark: {
      metricKey: 'whale_revenue_share',
      internalPercentileBand: 'p50',
      externalNorm: {
        value: 60,
        unit: '%',
        direction: 'higher-better',
        source: 'Industry whale-concentration reports (MMORPG skew)',
        citation:
          'MMORPG revenue concentration is typically even higher than shooters (top ~1–5% can drive >half). Verify jus top-rank share.',
      },
    },
    action: {
      text: 'Trigger white-glove care for top-rank whales showing inactivity (exclusive contact, retention offer).',
      leverFamily: 'whale-care',
    },
    defaultWrite: 'case',
    rationale:
      'A small set of top-progression whales drives the bulk of MMORPG revenue; their inactivity is the highest-value alert.',
  },
  {
    id: 'mmorpg-regional-channel-monetization',
    genreTags: ['social-mmorpg'],
    games: [],
    lever: 'Regional / channel monetization',
    signal: 'ARPPU or conversion diverging by region / payment channel',
    requiredCubes: [
      'billing_detail.payment_gateway',
      'user_recharge_daily.country_code',
      'user_recharge_daily.payment_channel',
    ],
    benchmark: {
      metricKey: 'arppu_vnd',
      internalPercentileBand: 'p50',
      externalNorm: {
        value: 0,
        unit: 'vnd',
        direction: 'higher-better',
        source: 'Drafted placeholder — region-specific',
        citation:
          'ARPPU varies by region/currency; no single norm. Use internal portfolio band; verify per-region targets.',
      },
    },
    action: {
      text: 'Tune pricing, promo intensity, or channel mix for under-converting regions/channels.',
      leverFamily: 'monetization-funnel',
    },
    defaultWrite: 'experiment',
    rationale:
      'Sharded MMORPGs span regions with very different willingness-to-pay; per-region tuning unlocks trapped ARPPU.',
  },
  {
    id: 'mmorpg-first-purchase-conversion',
    genreTags: ['social-mmorpg'],
    games: [],
    lever: 'First-purchase conversion',
    signal: 'First-time-payer rate falling — entry-offer or price friction',
    requiredCubes: ['mf_users.first_recharge_date', 'mf_users.ltv_vnd'],
    benchmark: {
      metricKey: 'payer_conversion_rate',
      internalPercentileBand: 'p50',
      externalNorm: {
        value: 5,
        unit: '%',
        direction: 'higher-better',
        source: 'Adjust / AppsFlyer mobile-game payer-conversion benchmarks',
        citation:
          'MMORPG payer conversion often exceeds casual norms (~3–8%); verify jus install→payer rate.',
      },
    },
    action: {
      text: 'Surface a starter pack / first-purchase offer or test entry price points.',
      mapsToPlaybookIds: ['01'],
      leverFamily: 'monetization-funnel',
    },
    defaultWrite: 'case',
    rationale:
      'Converting a free player to a first payment is the gateway to the vertical-spend ladder.',
  },

  // ── Genre-wide lever jus_vn cannot satisfy — demonstrates the data-gate. ──
  {
    id: 'mmorpg-guild-social-retention',
    genreTags: ['social-mmorpg'],
    games: [], // genre-wide; jus_vn lacks guild data → resolver withholds it
    lever: 'Guild social retention',
    signal: 'Guild membership shrinking — social anchor weakening',
    requiredCubes: ['guild_membership.guild_id', 'guild_membership.left_at'],
    benchmark: {
      metricKey: 'guild_member_share',
      internalPercentileBand: 'p50',
      externalNorm: {
        value: 2.5,
        unit: 'ratio',
        direction: 'higher-better',
        source: 'Industry consensus (guild retention studies)',
        citation:
          'Guild members retain materially longer in MMORPGs; only assessable where guild data exists.',
      },
    },
    action: {
      text: 'Run a guild event / guild-instability win-back where guild data is available.',
      leverFamily: 'social-retention',
    },
    defaultWrite: 'sweep',
    rationale:
      'Guilds are a core MMORPG retention anchor — but jus_vn models no guild data, so this lever is honestly withheld for it.',
  },
];
