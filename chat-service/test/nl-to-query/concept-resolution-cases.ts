/**
 * 50-case labeled dataset for the concept-resolution eval suite (phase 02a-E).
 *
 * Each case drives `resolveBestConcept` + the resolver-layer auto-route gate
 * and asserts the expected outcome. No live LLM calls, no network.
 *
 * Expectation schema:
 *   action     — 'auto' | 'clarify' (resolver-layer decision)
 *   conceptId  — resolved concept id (only when action='auto' via concept path)
 *   measureRef — expected defaultMeasureRef on the resolved concept
 *   intent     — expected intent slot value (informational; validated where stated)
 *   confidence — expected confidence bucket: 'exact' (1.0) | 'substring' (0.85) | 'none'
 *
 * Soft cases still count toward the pass rate (do not rig expectations to pass).
 * The 85% gate is enforced by the harness; borderline cases are noted, not hidden.
 */

export interface EvalCase {
  id: string;
  message: string;
  lang: 'en' | 'vi' | 'mixed';
  expect: {
    action: 'auto' | 'clarify';
    conceptId?: string;
    measureRef?: string;
    intent?: 'leaderboard' | 'aggregate' | 'trend' | 'comparison';
    confidence?: 'exact' | 'substring' | 'none';
  };
  /** Soft: known gap — failure is a resolver signal, not a test rig. */
  soft?: boolean;
  note?: string;
}

export const EVAL_CASES: EvalCase[] = [
  // ─── Group A: Clear concept + leaderboard phrase → auto ──────────────────
  // Resolver path: leaderboard intent + rankable concept + confidence≥0.8 + gap≥0.2
  {
    id: 'A01',
    message: 'top spenders this week',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: 'canonical leaderboard phrase; spender alias at 0.85, gap=1',
  },
  {
    id: 'A02',
    message: 'biggest whales last month',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'whale',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: '"biggest" leaderboard keyword + whale alias',
  },
  {
    id: 'A03',
    message: 'top 10 payers this month',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: '"payers" is spender alias; limit hint 10',
  },
  {
    id: 'A04',
    message: 'highest paying users by revenue last 7 days',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: '"paying users" is a spender alias; "highest" triggers leaderboard',
  },
  {
    id: 'A05',
    message: 'ranked payers in Q1 2026',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: '"ranked" triggers leaderboard; payers → spender',
  },
  {
    id: 'A06',
    message: 'top 5 whales this week',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'whale',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: 'explicit limit 5 + whale concept',
  },
  {
    id: 'A07',
    message: 'show me the leaderboard for spenders',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: '"leaderboard" keyword + spender alias',
  },
  {
    id: 'A08',
    message: 'highest spenders last 30 days',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: '"highest" + spender + time range',
  },
  {
    id: 'A09',
    message: 'top high spender this quarter',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'whale',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: '"high spender" (singular) is whale alias; longer alias wins over "spender"',
  },
  // ─── Group B: Exact full-message alias → auto (confidence=1.0) ───────────
  // Resolver path: findExactMatch short-circuit (no leaderboard intent required)
  {
    id: 'B01',
    message: 'spender',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      confidence: 'exact',
    },
    note: 'exact id match → short-circuit, conf=1.0',
  },
  {
    id: 'B02',
    message: 'spenders',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      confidence: 'exact',
    },
    note: 'exact alias spenders → spender',
  },
  {
    id: 'B03',
    message: 'payer',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      confidence: 'exact',
    },
    note: 'exact alias payer → spender',
  },
  {
    id: 'B04',
    message: 'whale',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'whale',
      confidence: 'exact',
    },
    note: 'exact alias whale',
  },
  {
    id: 'B05',
    message: 'whales',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'whale',
      confidence: 'exact',
    },
    note: 'exact alias whales',
  },
  {
    id: 'B06',
    message: 'first-time payer',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'first-time-payer',
      confidence: 'exact',
    },
    note: 'exact alias for first-time payer concept',
  },
  {
    id: 'B07',
    message: 'ftp',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'first-time-payer',
      confidence: 'exact',
    },
    note: 'exact alias ftp → first-time-payer',
  },
  {
    id: 'B08',
    message: 'high spender',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'whale',
      confidence: 'exact',
    },
    note: 'exact alias "high spender" → whale',
  },
  // ─── Group C: Vietnamese / code-switched phrasings ───────────────────────
  {
    id: 'C01',
    message: 'top người trả phí tháng này',
    lang: 'vi',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: 'VI alias người trả phí + "top" leaderboard trigger',
  },
  {
    id: 'C02',
    message: 'người chi tiêu nhiều nhất tuần này',
    lang: 'vi',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: 'VI alias người chi tiêu + nhiều nhất (leaderboard intent)',
  },
  {
    id: 'C03',
    message: 'top whale tháng này',
    lang: 'mixed',
    expect: {
      action: 'auto',
      conceptId: 'whale',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: 'code-switched: EN concept term in VI sentence',
  },
  {
    id: 'C05',
    message: 'người trả phí',
    lang: 'vi',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      confidence: 'exact',
    },
    note: 'exact VI alias match for spender → auto via findExactMatch',
  },
  {
    id: 'C06',
    message: 'xếp hạng spenders trong tháng 3',
    lang: 'mixed',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: 'xếp hạng = ranked (leaderboard intent) + EN concept',
  },
  {
    id: 'C07',
    message: 'top payers trong tuần này',
    lang: 'mixed',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: 'mixed: EN top + EN alias + VI time phrase',
  },

  // ─── Group D: Ambiguous / no-concept → clarify ───────────────────────────
  {
    id: 'D01',
    message: 'show me revenue',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'none',
    },
    note: 'revenue is not a concept-tier term; no leaderboard intent → clarify',
  },
  {
    id: 'D02',
    message: 'how many users signed up this week',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'none',
    },
    note: 'no concept match; intent=aggregate → clarify on metric',
  },
  {
    id: 'D03',
    message: 'what is the trend of dau',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'none',
    },
    note: 'DAU is not a concept term; no concept resolver hit → clarify',
  },
  {
    id: 'D04',
    message: 'xyz abc 123',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'none',
    },
    note: 'completely unrecognised message → clarify',
  },
  {
    id: 'D06',
    message: 'doanh thu tháng này',
    lang: 'vi',
    expect: {
      action: 'clarify',
      confidence: 'none',
    },
    note: 'doanh thu (revenue) is not a concept-tier term → clarify',
  },
  {
    id: 'D07',
    message: 'top of the funnel',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'none',
    },
    note: '"top of the funnel" hits FALSE_POSITIVES_RE → intent=aggregate; no concept → clarify',
  },
  {
    id: 'D08',
    message: 'active users',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'active-user',
      confidence: 'exact',
    },
    note: '"active users" exact alias → active-user via findExactMatch → auto (no ranking needed for exact path)',
  },

  // ─── Group E: Near-collision — two concepts both partially match ──────────
  // Both concepts score 0.85 (substring), gap=0 < 0.2 threshold → clarify
  {
    id: 'E01',
    message: 'top spenders and whales this week',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'substring',
    },
    note: 'two concepts hit (spender@0.85, whale@0.85) gap=0 < 0.2 → clarify',
  },
  {
    id: 'E02',
    message: 'compare whales vs payers last month',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'substring',
    },
    note: 'two concepts (whale, spender) + comparison intent; gap=0 → clarify',
  },
  {
    id: 'E03',
    message: 'leaderboard for spenders or first time payer',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'substring',
    },
    note: 'two distinct concepts → gap=0 → clarify despite leaderboard keyword',
  },

  // ─── Group F: Cube-ref / exact-id short-circuits ─────────────────────────
  {
    id: 'F01',
    message: 'recharge.revenue_vnd',
    lang: 'en',
    expect: {
      action: 'auto',
      measureRef: 'recharge.revenue_vnd',
      confidence: 'exact',
    },
    note: 'fully-qualified cube ref → auto via firstCubeRef, no assumption',
  },
  {
    id: 'F02',
    message: 'first time payer',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'first-time-payer',
      confidence: 'exact',
    },
    note: 'exact alias "first time payer" (space variant) → findExactMatch → auto',
  },
  {
    id: 'F03',
    message: 'paying user',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      confidence: 'exact',
    },
    note: '"paying user" exact alias of spender → findExactMatch → auto',
  },

  // ─── Group G: Plural / time-range variants of clear concepts ─────────────
  {
    id: 'G01',
    message: 'top spender this week',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: 'singular spender alias; leaderboard path',
  },
  {
    id: 'G04',
    message: 'rank spenders by revenue this quarter',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: '"rank" keyword + spender + time range',
  },
  {
    id: 'G05',
    message: 'who are the top whales',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'whale',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: '"top" + whales alias → auto',
  },
  {
    id: 'G06',
    message: 'top paying users this week',
    lang: 'en',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: '"paying users" is spender alias',
  },

  // ─── Group H: Non-rankable concept / no leaderboard intent ───────────────
  // These concepts exist in the glossary but either lack ranking metadata
  // or lack leaderboard intent in the message → resolver cannot auto-route.
  {
    id: 'H01',
    message: 'show churners this month',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'none',
    },
    note: 'churner concept has no ranking metadata; no leaderboard keyword → clarify',
    soft: true,
  },
  {
    id: 'H02',
    message: 'count of new spenders last week',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'none',
    },
    note: 'new-spender has no ranking; "count" implies aggregate not leaderboard → clarify',
    soft: true,
  },
  {
    id: 'H03',
    message: 'how many first time payers in March',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'none',
    },
    note: 'first-time-payer has no ranking + no leaderboard intent → clarify',
  },
  {
    id: 'H04',
    message: 'dormant users by country',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'none',
    },
    note: 'dormant-user has no ranking; no leaderboard keyword → clarify',
    soft: true,
  },

  // ─── Group I: Substring-only concept hits, no leaderboard keyword ─────────
  // The v2 leaderboard-concept path only fires when intent=leaderboard.
  // Without that, substring hits fall through to the engine which clarifies.
  {
    id: 'I01',
    message: 'i want to see spender data',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'substring',
    },
    note: 'spender substring hit but no leaderboard intent → v2 path does not fire → clarify',
  },
  {
    id: 'I02',
    message: 'give me information about whales',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'substring',
    },
    note: 'whale substring hit but no leaderboard intent → clarify',
  },
  {
    id: 'I03',
    message: 'payment data for payer segment',
    lang: 'en',
    expect: {
      action: 'clarify',
      confidence: 'substring',
    },
    note: 'payer substring + no leaderboard keyword → clarify',
  },

  // ─── Group J: Mixed-lang with time ranges ─────────────────────────────────
  {
    id: 'J01',
    message: 'top spenders tuần trước',
    lang: 'mixed',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: 'EN concept + VI time range "tuần trước" (last week)',
  },
  {
    id: 'J02',
    message: 'danh sách whales tháng 4',
    lang: 'mixed',
    expect: {
      action: 'clarify',
      confidence: 'substring',
    },
    note: '"danh sách" (list) does not trigger leaderboard intent → clarify',
    soft: true,
  },
  {
    id: 'J03',
    message: 'top 10 người trả phí tuần này',
    lang: 'vi',
    expect: {
      action: 'auto',
      conceptId: 'spender',
      measureRef: 'recharge.revenue_vnd',
      intent: 'leaderboard',
      confidence: 'substring',
    },
    note: 'full VI phrase: top 10 + VI alias + VI time',
  },
];

// Runtime guard — evaluated once at import; keeps the count honest.
if (EVAL_CASES.length !== 50) {
  throw new Error(`EVAL_CASES must have exactly 50 entries, got ${EVAL_CASES.length}`);
}
