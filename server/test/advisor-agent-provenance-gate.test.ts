/**
 * The HYBRID provenance gate: numbers in a card/draft must trace to a registered
 * tool result (known id + matching value). Forged numbers are rejected.
 */
import { describe, it, expect } from 'vitest';
import {
  ProvenanceLedger,
  collectNumbers,
  validateDraftNumbers,
} from '../src/advisor/agent/agent-provenance-gate.js';

describe('collectNumbers', () => {
  it('recursively gathers finite numbers (incl numeric strings)', () => {
    const nums = collectNumbers({ a: 1, b: '2.5', c: [3, { d: 4 }], e: 'x', f: null });
    expect(nums.sort()).toEqual([1, 2.5, 3, 4]);
  });
});

describe('ProvenanceLedger', () => {
  it('registers a result and confirms its numbers; rejects unknown ids', () => {
    const ledger = new ProvenanceLedger();
    const id = ledger.register('recommend', { effect: 0.06, addressableN: 2400 });
    expect(ledger.has(id)).toBe(true);
    expect(ledger.contains(id, 0.06)).toBe(true);
    expect(ledger.contains(id, 9999)).toBe(false);
    expect(ledger.contains('recommend#999', 0.06)).toBe(false);
  });

  it('validateClaims flags missing, unknown, and mismatched provenance', () => {
    const ledger = new ProvenanceLedger();
    const id = ledger.register('check_power', { mde: 4.2 });
    const violations = ledger.validateClaims([
      { field: 'a', value: 4.2, provenanceId: id }, // ok
      { field: 'b', value: 4.2 }, // missing id
      { field: 'c', value: 4.2, provenanceId: 'bogus#1' }, // unknown id
      { field: 'd', value: 7.7, provenanceId: id }, // value mismatch
    ]);
    expect(violations.map((v) => `${v.field}:${v.reason}`)).toEqual([
      'b:missing_provenance',
      'c:unknown_provenance',
      'd:value_mismatch',
    ]);
  });
});

describe('validateDraftNumbers', () => {
  const genuineDraft = {
    cohort: { addressableN: 2400 },
    power: { mde: 4.2 },
    expectedEffect: { value: 0.06 },
    money: { incrementalVnd: 360_000_000 },
  };

  it('accepts a draft whose numbers all trace to the cited tool result', () => {
    const ledger = new ProvenanceLedger();
    const id = ledger.register('recommend', {
      addressableN: 2400,
      mde: 4.2,
      effect: 0.06,
      incrementalVnd: 360_000_000,
    });
    expect(validateDraftNumbers(genuineDraft, id, ledger)).toEqual([]);
  });

  it('REJECTS a draft with a forged number not in the ledger', () => {
    const ledger = new ProvenanceLedger();
    const id = ledger.register('recommend', { addressableN: 2400, mde: 4.2, effect: 0.06 });
    const forged = { ...genuineDraft, money: { incrementalVnd: 999_999_999 } };
    const violations = validateDraftNumbers(forged, id, ledger);
    expect(violations.some((v) => v.field === 'money.incrementalVnd' && v.reason === 'value_mismatch')).toBe(true);
  });

  it('REJECTS a draft that cites no provenance at all', () => {
    const ledger = new ProvenanceLedger();
    const violations = validateDraftNumbers(genuineDraft, undefined, ledger);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every((v) => v.reason === 'missing_provenance')).toBe(true);
  });
});
