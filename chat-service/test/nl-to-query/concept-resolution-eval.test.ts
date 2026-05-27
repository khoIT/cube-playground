/**
 * Phase 02a-E — concept-resolution eval suite (50 cases).
 *
 * STRATEGY: evaluates the resolver stack deterministically — no live LLM,
 * no network, no DB. Two layers are exercised per case:
 *
 *   Layer 1 (resolver): resolveBestConcept + findExactMatch + firstCubeRef
 *     → produces conceptId, confidence, gap
 *   Layer 2 (routing): applies the same auto-route gate the disambig handler uses
 *     (confidence >= THRESHOLD && gap >= 0.2) to infer the expected action
 *
 * The full disambig handler (with DB + mocked glossary client) is used only
 * for the integration spot-checks in the last describe block. The 50-case
 * gate runs entirely at the resolver layer, which is the relevant signal for
 * the ramp gate ("concept-resolution eval pass rate >= 85%").
 *
 * Failure = the inferred action or conceptId disagrees with the labeled expectation.
 * Soft cases still count toward the pass rate — do not rig expectations.
 *
 * Gate: suite FAILS if pass rate < 85%.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveBestConcept,
  isConceptTerm,
} from '../../src/nl-to-query/concept-resolver.js';
import { findExactMatch } from '../../src/nl-to-query/synonym-resolver.js';
import { firstCubeRef } from '../../src/nl-to-query/recognise-cube-ref.js';
import { classifyIntent } from '../../src/nl-to-query/intent-classifier.js';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';
import { EVAL_CASES, type EvalCase } from './concept-resolution-cases.js';

// ─── Fixture glossary ────────────────────────────────────────────────────────
// Mirrors the concept-tier seed from server/data/glossary.seed.json plus the
// non-concept terms referenced in D-group cases. Keep in sync with the
// production seed when new concepts are added.

function term(overrides: Partial<OfficialTerm> & { id: string }): OfficialTerm {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    description: overrides.description ?? '',
    primaryCatalogId: overrides.primaryCatalogId ?? null,
    aliases: overrides.aliases ?? [],
    aliasesVi: overrides.aliasesVi ?? [],
    labelVi: overrides.labelVi ?? null,
    category: overrides.category ?? null,
    entityCube: overrides.entityCube ?? null,
    entityPk: overrides.entityPk ?? null,
    defaultMeasureRef: overrides.defaultMeasureRef ?? null,
    defaultFilter: overrides.defaultFilter ?? null,
    ranking: overrides.ranking ?? null,
    trustTier: overrides.trustTier ?? null,
  };
}

// Concept-tier terms (all have entityCube + defaultMeasureRef + ranking)
const SPENDER = term({
  id: 'spender',
  label: 'Spender',
  labelVi: 'Người trả phí',
  aliases: ['spender', 'spenders', 'payer', 'payers', 'paying user', 'paying users'],
  aliasesVi: ['người trả phí', 'người chi tiêu', 'khách trả phí'],
  category: 'monetisation',
  entityCube: 'players',
  entityPk: 'players.user_id',
  defaultMeasureRef: 'recharge.revenue_vnd',
  defaultFilter: { member: 'recharge.revenue_vnd', op: '>', value: 0 },
  ranking: { order: 'DESC', default_limit: 10 },
  trustTier: 'certified',
});

const WHALE = term({
  id: 'whale',
  label: 'Whale',
  aliases: ['whale', 'whales', 'high spender'],
  category: 'monetisation',
  entityCube: 'players',
  entityPk: 'players.user_id',
  defaultMeasureRef: 'recharge.revenue_vnd',
  defaultFilter: { member: 'recharge.revenue_vnd', op: '>', value: 0 },
  ranking: { order: 'DESC', default_limit: 10 },
  trustTier: 'certified',
});

// Non-rankable: no ranking field
const FIRST_TIME_PAYER = term({
  id: 'first-time-payer',
  label: 'First-time payer',
  aliases: ['first time payer', 'first-time payer', 'ftp', 'first time payers'],
  category: 'monetisation',
  entityCube: 'players',
  entityPk: 'players.user_id',
  defaultMeasureRef: 'recharge.revenue_vnd',
  // no ranking → non-rankable
});

// Non-rankable: churner (has entityCube but no ranking)
const CHURNER = term({
  id: 'churner',
  label: 'Churner',
  aliases: ['churner', 'churners', 'churned user', 'churned users'],
  category: 'engagement',
  entityCube: 'players',
  entityPk: 'players.user_id',
  defaultMeasureRef: 'recharge.revenue_vnd',
  // no ranking
});

// Concept with entityCube but no ranking (active-user)
const ACTIVE_USER = term({
  id: 'active-user',
  label: 'Active user',
  aliases: ['active user', 'active users'],
  aliasesVi: ['người dùng hoạt động'],
  category: 'engagement',
  entityCube: 'players',
  entityPk: 'players.user_id',
  defaultMeasureRef: 'players.count',
  // no ranking — aggregate path only
});

// Concept with entityCube but no ranking (dormant-user)
const DORMANT_USER = term({
  id: 'dormant-user',
  label: 'Dormant user',
  aliases: ['dormant user', 'dormant users'],
  category: 'engagement',
  entityCube: 'players',
  entityPk: 'players.user_id',
  // no ranking
});

// Non-concept terms (should never appear in resolveConcepts output)
const DAU = term({
  id: 'dau',
  label: 'DAU',
  aliases: ['dau', 'daily active users'],
  aliasesVi: ['dau', 'người dùng hoạt động ngày'],
  primaryCatalogId: 'business_metrics.dau',
  category: 'engagement',
  // no entityCube → not a concept
});

const REVENUE = term({
  id: 'revenue',
  label: 'Revenue',
  labelVi: 'Doanh thu',
  aliases: ['revenue', 'gross revenue'],
  aliasesVi: ['doanh thu', 'tổng doanh thu'],
  primaryCatalogId: 'business_metrics.revenue',
  category: 'monetisation',
  // no entityCube → not a concept
});

const NEW_SPENDER = term({
  id: 'new-spender',
  label: 'New spender',
  aliases: ['new spender', 'new spenders'],
  category: 'monetisation',
  entityCube: 'players',
  entityPk: 'players.user_id',
  defaultMeasureRef: 'recharge.revenue_vnd',
  // no ranking → non-rankable
});

/** Full fixture glossary used by all eval cases. */
const FIXTURE_GLOSSARY: OfficialTerm[] = [
  SPENDER,
  WHALE,
  FIRST_TIME_PAYER,
  CHURNER,
  ACTIVE_USER,
  DORMANT_USER,
  NEW_SPENDER,
  DAU,
  REVENUE,
];

/** Known Cube members for the firstCubeRef check (F01 case). */
const KNOWN_MEMBERS = new Set([
  'recharge.revenue_vnd',
  'recharge.event_date',
  'players.user_id',
  'players.event_date',
  'players.count',
]);

// ─── Auto-route gate — mirrors disambig handler logic ────────────────────────

const AUTOROUTE_THRESHOLD = 0.8;
const GAP_THRESHOLD = 0.2;

/**
 * Infer the expected action from the resolver outputs, replicating the
 * applyGlossaryV2 gate in disambiguate-query.ts:
 *   1. cube-ref hit → auto
 *   2. exact alias match → auto
 *   3. leaderboard intent + rankable concept + confidence>=0.8 + gap>=0.2 → auto
 *   4. anything else → clarify
 *
 * Returns { action, resolvedConceptId, resolvedMeasureRef, confidence, gap }.
 */
function runResolverLayer(message: string): {
  action: 'auto' | 'clarify';
  resolvedConceptId?: string;
  resolvedMeasureRef?: string;
  confidence?: number;
  gap?: number;
  path: 'cube-ref' | 'exact-alias' | 'leaderboard-concept' | 'none';
} {
  // Step 1: fully-qualified cube ref
  const cubeRef = firstCubeRef(message, KNOWN_MEMBERS);
  if (cubeRef) {
    return {
      action: 'auto',
      resolvedMeasureRef: cubeRef.hit.cubeRef,
      confidence: 1.0,
      path: 'cube-ref',
    };
  }

  // Step 2: exact alias match
  const exact = findExactMatch(message, FIXTURE_GLOSSARY);
  if (exact) {
    const conceptId = exact.term.id;
    const measureRef = exact.term.defaultMeasureRef ?? undefined;
    return {
      action: 'auto',
      resolvedConceptId: conceptId,
      resolvedMeasureRef: measureRef,
      confidence: 1.0,
      path: 'exact-alias',
    };
  }

  // Step 3: leaderboard concept path
  const intent = classifyIntent(message);
  if (intent.slot.value === 'leaderboard') {
    const conceptResolution = resolveBestConcept(message, FIXTURE_GLOSSARY);
    if (conceptResolution) {
      const { confidence, gap, best } = conceptResolution;
      // Must have ranking to be auto-routable
      const hasRanking = !!best.term.ranking;
      if (
        hasRanking &&
        confidence >= AUTOROUTE_THRESHOLD &&
        gap >= GAP_THRESHOLD
      ) {
        return {
          action: 'auto',
          resolvedConceptId: best.conceptId,
          resolvedMeasureRef: best.term.defaultMeasureRef ?? undefined,
          confidence,
          gap,
          path: 'leaderboard-concept',
        };
      }
      // Concept hit but below gate → clarify
      return {
        action: 'clarify',
        resolvedConceptId: best.conceptId,
        confidence,
        gap,
        path: 'leaderboard-concept',
      };
    }
  }

  // Non-leaderboard concept substring hit: the v2 leaderboard-concept path only
  // fires when intent=leaderboard. Without that intent, the hit falls through to
  // the base engine which clarifies on missing metric/time. Record the concept
  // hit for diagnostics but return clarify — this is the correct resolver behaviour.
  const anyConcept = resolveBestConcept(message, FIXTURE_GLOSSARY);
  if (anyConcept) {
    return {
      action: 'clarify',
      resolvedConceptId: anyConcept.best.conceptId,
      confidence: anyConcept.confidence,
      gap: anyConcept.gap,
      path: 'none',
    };
  }

  return { action: 'clarify', path: 'none' };
}

// ─── Eval harness ────────────────────────────────────────────────────────────

interface CaseResult {
  id: string;
  soft: boolean;
  pass: boolean;
  expected: EvalCase['expect'];
  got: ReturnType<typeof runResolverLayer>;
  failReasons: string[];
}

describe('concept-resolution eval suite (50 cases)', () => {
  const results: CaseResult[] = [];

  // Validate we have exactly 50 cases
  it('fixture has exactly 50 labeled cases', () => {
    expect(EVAL_CASES).toHaveLength(50);
  });

  // Sanity check on fixture glossary: concept detection
  it('fixture glossary has expected concept-tier terms', () => {
    const concepts = FIXTURE_GLOSSARY.filter(isConceptTerm);
    const ids = concepts.map((c) => c.id);
    expect(ids).toContain('spender');
    expect(ids).toContain('whale');
    // Non-concept terms should not be picked up
    expect(FIXTURE_GLOSSARY.filter((t) => !isConceptTerm(t)).map((t) => t.id)).toContain('dau');
    expect(FIXTURE_GLOSSARY.filter((t) => !isConceptTerm(t)).map((t) => t.id)).toContain('revenue');
  });

  // Per-case assertions
  for (const c of EVAL_CASES) {
    it(`[${c.id}] ${c.message.slice(0, 60)}`, () => {
      const got = runResolverLayer(c.message);
      const failReasons: string[] = [];

      // Primary: action must match
      if (got.action !== c.expect.action) {
        failReasons.push(`action: expected "${c.expect.action}", got "${got.action}" (path=${got.path})`);
      }

      // When expect.action === 'auto' and conceptId is specified, validate it
      if (c.expect.action === 'auto' && c.expect.conceptId) {
        if (got.resolvedConceptId !== c.expect.conceptId) {
          failReasons.push(
            `conceptId: expected "${c.expect.conceptId}", got "${got.resolvedConceptId ?? 'none'}"`,
          );
        }
      }

      // When expect.measureRef is specified, validate it
      if (c.expect.measureRef) {
        if (got.resolvedMeasureRef !== c.expect.measureRef) {
          failReasons.push(
            `measureRef: expected "${c.expect.measureRef}", got "${got.resolvedMeasureRef ?? 'none'}"`,
          );
        }
      }

      // When expect.confidence bucket is specified, validate it
      if (c.expect.confidence && c.expect.confidence !== 'none') {
        const expectedScore = c.expect.confidence === 'exact' ? 1.0 : 0.85;
        if (got.confidence !== undefined && got.confidence !== expectedScore) {
          failReasons.push(
            `confidence: expected ${expectedScore}, got ${got.confidence}`,
          );
        }
      }

      const pass = failReasons.length === 0;
      results.push({ id: c.id, soft: c.soft ?? false, pass, expected: c.expect, got, failReasons });

      // Emit per-case failure as vitest assertion for visibility
      if (!pass) {
        // eslint-disable-next-line no-console
        console.warn(`  [${c.id}]${c.soft ? ' (soft)' : ''} FAIL: ${failReasons.join(' | ')}`);
      }
      // We always assert — soft cases still count toward pass rate
      expect(pass, `[${c.id}]: ${failReasons.join('; ')}`).toBe(true);
    });
  }

  // ─── Aggregate gate ────────────────────────────────────────────────────────
  it('aggregate pass rate >= 85% (ramp gate)', () => {
    const total = results.length;
    const passed = results.filter((r) => r.pass).length;
    const failed = results.filter((r) => !r.pass);
    const rate = total === 0 ? 0 : passed / total;

    // Print summary table
    // eslint-disable-next-line no-console
    console.log(
      `\n=== Concept-Resolution Eval Summary ===\n` +
      `  Pass: ${passed}/${total} (${(rate * 100).toFixed(1)}%)\n` +
      `  Fail: ${failed.length} cases`,
    );
    if (failed.length > 0) {
      // eslint-disable-next-line no-console
      console.table(
        failed.map((r) => ({
          id: r.id,
          soft: r.soft,
          reasons: r.failReasons.join(' | '),
          path: r.got.path,
          expectedAction: r.expected.action,
          gotAction: r.got.action,
          expectedConceptId: r.expected.conceptId ?? '-',
          gotConceptId: r.got.resolvedConceptId ?? '-',
        })),
      );
    }

    // Enforce ≥85% gate
    expect(rate, `pass rate ${(rate * 100).toFixed(1)}% < 85% gate`).toBeGreaterThanOrEqual(0.85);
  });
});

// ─── Integration spot-checks ─────────────────────────────────────────────────
// These drive resolveBestConcept + supporting helpers directly (not the full
// handler) to confirm the resolver internals are behaving correctly for the
// groups that matter most.

describe('concept-resolution eval — resolver internals spot-checks', () => {
  describe('Group A: clear leaderboard concept hits', () => {
    it('A01 top spenders → spender@0.85 gap=1', () => {
      const r = resolveBestConcept('top spenders this week', FIXTURE_GLOSSARY);
      expect(r).not.toBeNull();
      expect(r!.best.conceptId).toBe('spender');
      expect(r!.confidence).toBe(0.85);
      expect(r!.gap).toBe(1);
    });

    it('A02 biggest whales → whale@0.85 gap=1', () => {
      const r = resolveBestConcept('biggest whales last month', FIXTURE_GLOSSARY);
      expect(r).not.toBeNull();
      expect(r!.best.conceptId).toBe('whale');
      expect(r!.confidence).toBe(0.85);
    });

    it('A03 top 10 payers → spender (payers alias)', () => {
      const r = resolveBestConcept('top 10 payers this month', FIXTURE_GLOSSARY);
      expect(r!.best.conceptId).toBe('spender');
    });

    it('A09 high spender (singular) → whale alias match', () => {
      // "high spender" alias (11 chars) wins over "spender" (7 chars) via longest-match.
      // The plural "high spenders" would fail the word-boundary check after 'r', so use singular.
      const r = resolveBestConcept('top high spender this quarter', FIXTURE_GLOSSARY);
      expect(r!.best.conceptId).toBe('whale');
    });
  });

  describe('Group B: exact alias short-circuit', () => {
    it('B01 "spender" → exact match, id=spender', () => {
      const m = findExactMatch('spender', FIXTURE_GLOSSARY);
      expect(m).not.toBeNull();
      expect(m!.termId).toBe('spender');
      expect(m!.matchedOn).toBe('id');
    });

    it('B02 "spenders" → exact alias match', () => {
      const m = findExactMatch('spenders', FIXTURE_GLOSSARY);
      expect(m!.termId).toBe('spender');
      expect(m!.matchedOn).toBe('alias');
    });

    it('B04 "whale" → exact match', () => {
      const m = findExactMatch('whale', FIXTURE_GLOSSARY);
      expect(m!.termId).toBe('whale');
    });

    it('B07 "ftp" → exact alias → first-time-payer', () => {
      const m = findExactMatch('ftp', FIXTURE_GLOSSARY);
      expect(m!.termId).toBe('first-time-payer');
    });

    it('B08 "high spender" → exact alias → whale', () => {
      const m = findExactMatch('high spender', FIXTURE_GLOSSARY);
      expect(m!.termId).toBe('whale');
    });
  });

  describe('Group C: VI / code-switched aliases', () => {
    it('C05 "người trả phí" → exact VI alias → spender', () => {
      const m = findExactMatch('người trả phí', FIXTURE_GLOSSARY);
      expect(m!.termId).toBe('spender');
    });

    it('C01 "top người trả phí tháng này" → spender substring', () => {
      const r = resolveBestConcept('top người trả phí tháng này', FIXTURE_GLOSSARY);
      expect(r!.best.conceptId).toBe('spender');
      expect(r!.best.lang).toBe('vi');
    });

    it('C02 "người chi tiêu nhiều nhất" → spender (VI alias)', () => {
      const r = resolveBestConcept('người chi tiêu nhiều nhất tuần này', FIXTURE_GLOSSARY);
      expect(r!.best.conceptId).toBe('spender');
    });
  });

  describe('Group E: near-collision gap < 0.2', () => {
    it('E01 "top spenders and whales" → two concepts, gap=0', () => {
      const r = resolveBestConcept('top spenders and whales this week', FIXTURE_GLOSSARY);
      expect(r).not.toBeNull();
      // Both score 0.85 (substring) → gap = 0 → below threshold
      expect(r!.gap).toBeLessThan(GAP_THRESHOLD);
    });

    it('E03 "spenders or first time payer" → two distinct concept hits → gap<0.2', () => {
      const r = resolveBestConcept(
        'leaderboard for spenders or first time payer',
        FIXTURE_GLOSSARY,
      );
      expect(r).not.toBeNull();
      expect(r!.gap).toBeLessThan(GAP_THRESHOLD);
    });
  });

  describe('Group F: cube-ref short-circuit', () => {
    it('F01 "recharge.revenue_vnd" → cube ref hit', () => {
      const hit = firstCubeRef('recharge.revenue_vnd', KNOWN_MEMBERS);
      expect(hit).not.toBeNull();
      expect(hit!.hit.cubeRef).toBe('recharge.revenue_vnd');
    });

    it('random junk does not match cube ref', () => {
      expect(firstCubeRef('xyz abc', KNOWN_MEMBERS)).toBeNull();
    });
  });

  describe('Group D: no-concept messages return null from resolver', () => {
    it('D01 "show me revenue" → revenue is not a concept term', () => {
      const r = resolveBestConcept('show me revenue', FIXTURE_GLOSSARY);
      expect(r).toBeNull();
    });

    it('D03 "what is the trend of dau" → dau is not a concept term', () => {
      const r = resolveBestConcept('what is the trend of dau', FIXTURE_GLOSSARY);
      expect(r).toBeNull();
    });

    it('D07 "top of the funnel" → FALSE_POSITIVE filter in intent classifier', () => {
      const intent = classifyIntent('top of the funnel');
      expect(intent.slot.value).toBe('aggregate');
    });
  });

  describe('auto-route gate logic', () => {
    it('confidence=0.85 gap=1 → above threshold=0.8 and gap=0.2 → routes auto', () => {
      const result = runResolverLayer('top spenders this week');
      expect(result.action).toBe('auto');
      expect(result.gap).toBe(1);
    });

    it('gap=0 (two concepts) → below gap threshold → routes clarify', () => {
      const result = runResolverLayer('top spenders and whales this week');
      expect(result.action).toBe('clarify');
    });

    it('non-rankable concept (first-time-payer, no ranking) + leaderboard → clarify', () => {
      const result = runResolverLayer('top first time payers this month');
      // first-time-payer has no ranking → rankable=false → clarify
      expect(result.action).toBe('clarify');
    });
  });
});
