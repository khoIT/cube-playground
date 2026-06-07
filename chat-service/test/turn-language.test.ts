/**
 * Unit tests for the reply-language guardrail heuristics
 * (src/core/turn-language.ts). Pure functions — no mocks needed.
 */

import { describe, it, expect } from 'vitest';
import { detectMessageLanguage, resolveTurnLanguage } from '../src/core/turn-language.js';

describe('detectMessageLanguage', () => {
  it('detects Vietnamese via diacritics', () => {
    expect(detectMessageLanguage('Doanh thu tháng này của cfm_vn là bao nhiêu?')).toBe('vi');
    expect(detectMessageLanguage('số người chơi mới')).toBe('vi');
    expect(detectMessageLanguage('Đếm user whale')).toBe('vi'); // đ alone is a VN signal
  });

  it('detects diacritic-free Vietnamese via bare-word hits (≥2 required)', () => {
    expect(detectMessageLanguage('cho xem doanh thu 30 ngay')).toBe('vi');
    expect(detectMessageLanguage('bao nhieu nguoi choi hom qua')).toBe('vi');
  });

  it('does not flip English on a single stray collision word', () => {
    // 'qua' alone is one hit — stays English (≥2 ASCII words present).
    expect(detectMessageLanguage('show qua revenue trend')).toBe('en');
  });

  it('requires two DISTINCT Vietnamese words — repeats do not count twice', () => {
    expect(detectMessageLanguage('la la something else')).toBe('en');
  });

  it('detects English prose', () => {
    expect(detectMessageLanguage('show me revenue for the last 30 days')).toBe('en');
    expect(detectMessageLanguage('compare whales vs dolphins')).toBe('en');
  });

  it('returns null when there is no clear signal', () => {
    expect(detectMessageLanguage('revenue?')).toBe(null); // single word
    expect(detectMessageLanguage('123 456')).toBe(null);
    expect(detectMessageLanguage('👍')).toBe(null);
    expect(detectMessageLanguage('')).toBe(null);
  });

  it('ignores {{field:...}} tokens and code spans before detecting', () => {
    // Without stripping, the member name would add ASCII words → 'en'.
    expect(detectMessageLanguage('{{field:mf_users.ltv_vnd}} là gì?')).toBe('vi');
    expect(detectMessageLanguage('`mf_users.user_count` nghĩa là sao')).toBe('vi');
    // Token-only message has no prose signal at all.
    expect(detectMessageLanguage('{{field:mf_users.ltv_vnd}}')).toBe(null);
  });
});

describe('resolveTurnLanguage', () => {
  it('uses the current message when it has a clear language', () => {
    expect(resolveTurnLanguage('doanh thu hôm nay', ['show me revenue'])).toBe('vi');
    expect(resolveTurnLanguage('show me revenue', ['doanh thu hôm nay'])).toBe('en');
  });

  it('falls back to the most recent detectable prior user turn when ambiguous', () => {
    expect(resolveTurnLanguage('revenue?', ['show revenue please', 'doanh thu tháng này'])).toBe('vi');
    expect(resolveTurnLanguage('arpu?', ['doanh thu tháng này', 'now by country please'])).toBe('en');
  });

  it('skips ambiguous prior turns while walking back', () => {
    expect(resolveTurnLanguage('arpu?', ['doanh thu tháng này', '👍', 'ok'])).toBe('vi');
  });

  it('defaults to English on a fully ambiguous session', () => {
    expect(resolveTurnLanguage('revenue?', [])).toBe('en');
    expect(resolveTurnLanguage('🤔', ['👍'])).toBe('en');
  });
});
