/**
 * Template engine: fires only on members present in meta, works across bare
 * (local) and prefixed (prod) member names, never invents a member, degrades
 * gracefully on sparse schemas.
 */
import { describe, it, expect } from 'vitest';
import { buildTemplateQuestions } from '../../src/core/starter-question-templates.js';
import { extractMemberNames } from '../../src/core/cube-meta-cache.js';

function cube(name: string, measures: string[], dimensions: string[]) {
  return {
    name,
    measures: measures.map((m) => ({ name: `${name}.${m}`, type: 'number' })),
    dimensions: dimensions.map((d) => ({ name: `${name}.${d}`, type: 'string' })),
  };
}

/** Local-shaped meta (bare cube names, rich member set). */
const LOCAL_META = {
  cubes: [
    cube('mf_users',
      ['user_count', 'ltv_total_vnd', 'arpu_vnd'],
      ['payer_tier', 'days_since_last_active', 'churn_risk', 'lifecycle_stage', 'max_vip_level', 'platform', 'install_month']),
    cube('new_user_retention', ['rnru_d1', 'rnru_d7', 'rnru_d30', 'rpnpu_d7'], ['register_date']),
    cube('active_daily', ['dau'], ['log_date']),
    cube('marketing_cost', ['cost_vnd'], ['channel']),
  ],
};

/** Prod-shaped meta (game-prefixed cube names, same field segments). */
const PROD_META = {
  cubes: [
    cube('cfm_mf_users', ['ltv_total_vnd', 'user_count'], ['payer_tier', 'days_since_last_active']),
    cube('cfm_active_daily', ['dau'], ['log_date']),
  ],
};

const SPARSE_META = {
  cubes: [cube('events_raw', [], ['event_name', 'event_time'])],
};

describe('buildTemplateQuestions', () => {
  it('rich local meta fires a broad set with real member refs', () => {
    const questions = buildTemplateQuestions(LOCAL_META);
    expect(questions.length).toBeGreaterThanOrEqual(8);

    const known = extractMemberNames(LOCAL_META);
    for (const q of questions) {
      expect(q.targetCatalogIds.length).toBeGreaterThan(0);
      for (const ref of q.targetCatalogIds) expect(known.has(ref)).toBe(true);
    }
  });

  it('segment-arriving questions lead the order', () => {
    const ids = buildTemplateQuestions(LOCAL_META).map((q) => q.id);
    expect(ids[0]).toBe('dormant-whales');
    expect(ids).toContain('churn-risk-payers');
    expect(ids).toContain('vip-outreach-list');
  });

  it('prefixed prod meta resolves the same templates against prefixed members', () => {
    const questions = buildTemplateQuestions(PROD_META);
    const dormant = questions.find((q) => q.id === 'dormant-whales');
    expect(dormant).toBeDefined();
    expect(dormant!.targetCatalogIds).toContain('cfm_mf_users.payer_tier');
    expect(dormant!.targetCatalogIds).toContain('cfm_mf_users.days_since_last_active');
  });

  it('topic/category tags stay within the FE unions', () => {
    const topics = new Set(['liveops', 'user_acquisition', 'monetization']);
    const categories = new Set(['explore', 'metric_explain', 'compare', 'diagnose']);
    for (const q of buildTemplateQuestions(LOCAL_META)) {
      q.topicTags.forEach((t) => expect(topics.has(t)).toBe(true));
      q.categoryTags.forEach((c) => expect(categories.has(c)).toBe(true));
    }
  });

  it('sparse meta yields a small set without throwing or inventing members', () => {
    const questions = buildTemplateQuestions(SPARSE_META);
    expect(questions.length).toBe(0);
  });

  it('field matching is anchored — partial suffixes do not fire templates', () => {
    // `not_payer_tier` must not satisfy the `payer_tier` predicate.
    const meta = {
      cubes: [cube('mf_users', ['ltv_total_vnd'], ['not_payer_tier', 'days_since_last_active'])],
    };
    const ids = buildTemplateQuestions(meta).map((q) => q.id);
    expect(ids).not.toContain('dormant-whales');
    expect(ids).not.toContain('revenue-by-payer-tier');
  });

  it('measure-vs-dimension role is enforced', () => {
    // payer_tier present but as a MEASURE — dimension-requiring templates stay silent.
    const meta = {
      cubes: [cube('mf_users', ['payer_tier', 'ltv_total_vnd'], ['days_since_last_active'])],
    };
    const ids = buildTemplateQuestions(meta).map((q) => q.id);
    expect(ids).not.toContain('dormant-whales');
  });
});
