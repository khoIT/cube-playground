import { describe, expect, it } from 'vitest';

import {
  deriveIdFromLabel,
  draftToYamlPayload,
  emptyDraft,
  validateDraft,
} from '../composition-draft-types';

describe('deriveIdFromLabel', () => {
  it('lowercases + replaces non-alnum with underscores', () => {
    expect(deriveIdFromLabel('Daily Active Users')).toBe('daily_active_users');
    expect(deriveIdFromLabel(' DAU ')).toBe('dau');
    expect(deriveIdFromLabel('ARPDAU (d7)')).toBe('arpdau_d7');
  });

  it('strips leading digits/symbols', () => {
    expect(deriveIdFromLabel('7-day ARPU')).toBe('day_arpu');
  });
});

describe('validateDraft', () => {
  it('flags missing label, id, owner', () => {
    const d = emptyDraft();
    d.measureRef = 'recharge.revenue_vnd';
    const v = validateDraft(d);
    expect(v.ok).toBe(false);
    expect(v.byStep[4]).toContain('Label required');
    expect(v.byStep[4]).toContain('ID required');
    expect(v.byStep[4]).toContain('Owner required');
  });

  it('passes for valid measure draft', () => {
    const d = {
      ...emptyDraft(),
      id: 'my_metric',
      label: 'My metric',
      owner: 'data@vng',
      formulaKind: 'measure' as const,
      measureRef: 'recharge.revenue_vnd',
    };
    expect(validateDraft(d).ok).toBe(true);
  });

  it('requires both ratio sides + rejects same num/denom', () => {
    const d = {
      ...emptyDraft(),
      id: 'r1',
      label: 'r1',
      owner: 'data@vng',
      formulaKind: 'ratio' as const,
      ratioNumerator: 'a.b',
      ratioDenominator: 'a.b',
    };
    const v = validateDraft(d);
    expect(v.byStep[3]).toContain('Numerator and denominator must differ');
  });

  it('rejects malformed id', () => {
    const d = {
      ...emptyDraft(),
      id: '7badId',
      label: 'L',
      owner: 'o@v',
      measureRef: 'a.b',
    };
    const v = validateDraft(d);
    expect(v.ok).toBe(false);
    expect(v.byStep[4].some((m) => m.includes('match'))).toBe(true);
  });
});

describe('draftToYamlPayload', () => {
  it('emits measure formula shape', () => {
    const d = {
      ...emptyDraft(),
      id: 'dau',
      label: 'DAU',
      owner: 'data@vng',
      formulaKind: 'measure' as const,
      measureRef: 'mf_users.dau',
    };
    const yaml = draftToYamlPayload(d) as {
      formula: { type: string; ref: string };
      trust: string;
    };
    expect(yaml.formula).toEqual({ type: 'measure', ref: 'mf_users.dau' });
    expect(yaml.trust).toBe('draft');
  });

  it('emits ratio formula shape', () => {
    const d = {
      ...emptyDraft(),
      id: 'arpdau',
      label: 'ARPDAU',
      owner: 'data@vng',
      formulaKind: 'ratio' as const,
      ratioNumerator: 'recharge.revenue_vnd',
      ratioDenominator: 'mf_users.dau',
    };
    const yaml = draftToYamlPayload(d) as {
      formula: { type: string; numerator: string; denominator: string };
    };
    expect(yaml.formula).toEqual({
      type: 'ratio',
      numerator: 'recharge.revenue_vnd',
      denominator: 'mf_users.dau',
    });
  });
});
