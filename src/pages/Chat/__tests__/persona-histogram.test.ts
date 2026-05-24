import { describe, it, expect } from 'vitest';
import { rankStarters } from '../library/persona-histogram';
import { STARTER_QUESTIONS } from '../library/starter-questions';

describe('rankStarters', () => {
  it('cold-start returns starters in source order with zero score', () => {
    const out = rankStarters({
      starters: STARTER_QUESTIONS,
      recentCategories: [],
      sessionCount: 0,
      minSessions: 3,
    });
    expect(out.length).toBe(STARTER_QUESTIONS.length);
    expect(out.every((r) => r.score === 0)).toBe(true);
    expect(out[0].starter.id).toBe(STARTER_QUESTIONS[0].id);
  });

  it('cold-start when below threshold even with categories', () => {
    const out = rankStarters({
      starters: STARTER_QUESTIONS,
      recentCategories: ['diagnose', 'diagnose', 'diagnose'],
      sessionCount: 2, // below threshold
      minSessions: 3,
    });
    expect(out.every((r) => r.score === 0)).toBe(true);
  });

  it('promotes starters tagged with user-preferred category', () => {
    const out = rankStarters({
      starters: STARTER_QUESTIONS,
      recentCategories: ['diagnose', 'diagnose', 'diagnose', 'diagnose'],
      sessionCount: 4,
      minSessions: 3,
    });
    const top = out[0].starter;
    expect(top.categoryTags).toContain('diagnose');
    // Tail must NOT include diagnose at the very top (heavy weight up front)
    expect(out[out.length - 1].score).toBeLessThanOrEqual(out[0].score);
  });

  it('is deterministic on ties (stable id order)', () => {
    const a = rankStarters({
      starters: STARTER_QUESTIONS,
      recentCategories: ['explore', 'compare'],
      sessionCount: 5,
      minSessions: 3,
    });
    const b = rankStarters({
      starters: STARTER_QUESTIONS,
      recentCategories: ['explore', 'compare'],
      sessionCount: 5,
      minSessions: 3,
    });
    expect(a.map((r) => r.starter.id)).toEqual(b.map((r) => r.starter.id));
  });
});
