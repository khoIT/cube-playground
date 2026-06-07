/**
 * Additive follow-up detector — conservative bilingual marker matching with
 * residual-phrase extraction. False positives hijack new questions onto the
 * previous query, so the negatives matter as much as the positives.
 */

import { describe, it, expect } from 'vitest';
import {
  detectAdditiveFollowUp,
  isFollowUpShaped,
} from '../../src/nl-to-query/additive-follow-up.js';

describe('detectAdditiveFollowUp — positives', () => {
  it('the 3542a7c1 message: "add in user count per day"', () => {
    const r = detectAdditiveFollowUp('add in user count per day');
    expect(r.isAdditive).toBe(true);
    expect(r.residualPhrase).toBe('user count per day');
  });

  it('"also show revenue"', () => {
    const r = detectAdditiveFollowUp('also show revenue');
    expect(r).toEqual({ isAdditive: true, residualPhrase: 'revenue' });
  });

  it('"add total kills to the chart" strips the chart-reference tail', () => {
    const r = detectAdditiveFollowUp('add total kills to the chart');
    expect(r.isAdditive).toBe(true);
    expect(r.residualPhrase).toBe('total kills');
  });

  it('VI: "thêm số người chơi mỗi ngày"', () => {
    const r = detectAdditiveFollowUp('thêm số người chơi mỗi ngày');
    expect(r.isAdditive).toBe(true);
    expect(r.residualPhrase).toBe('số người chơi mỗi ngày');
  });

  it('VI: "cùng với doanh thu"', () => {
    const r = detectAdditiveFollowUp('cùng với doanh thu');
    expect(r.isAdditive).toBe(true);
    expect(r.residualPhrase).toBe('doanh thu');
  });

  it('polite prefix: "please also include paying users"', () => {
    const r = detectAdditiveFollowUp('please also include paying users');
    expect(r.isAdditive).toBe(true);
    expect(r.residualPhrase).toBe('paying users');
  });
});

describe('detectAdditiveFollowUp — negatives', () => {
  it.each([
    'address churn in the report', // "add" inside a word
    'added value per user last week', // past tense is narrative, not a command
    'what drives the most matches', // no marker at all
    'show me DAU by country', // new question
    'add', // bare marker, nothing to resolve
  ])('rejects %j', (msg) => {
    expect(detectAdditiveFollowUp(msg).isAdditive).toBe(false);
  });
});

describe('isFollowUpShaped', () => {
  it('≤6 words is follow-up-shaped', () => {
    expect(isFollowUpShaped('user count')).toBe(true);
    expect(isFollowUpShaped('user count per day please now')).toBe(true);
  });
  it('a long new question is not', () => {
    expect(isFollowUpShaped('what are the currency outflow reasons for whales last week')).toBe(false);
  });
});
