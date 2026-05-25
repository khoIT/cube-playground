/**
 * Tests for response-cache-key.ts:
 *   - normalize: whitespace collapsing, lowercase, trailing punctuation strip
 *   - computeCacheKey: deterministic; changes when any input changes
 *   - chunkText: correct chunking at boundary
 */

import { describe, it, expect } from 'vitest';
import { normalize, computeCacheKey, chunkText, sha256 } from '../response-cache-key.js';

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------

describe('normalize', () => {
  it('lowercases input', () => {
    expect(normalize('Hello World')).toBe('hello world');
  });

  it('collapses internal whitespace', () => {
    expect(normalize('show   me   revenue')).toBe('show me revenue');
  });

  it('strips trailing period', () => {
    expect(normalize('show revenue.')).toBe('show revenue');
  });

  it('strips trailing question mark', () => {
    expect(normalize('what is revenue?')).toBe('what is revenue');
  });

  it('strips trailing multiple punctuation', () => {
    expect(normalize('show revenue...')).toBe('show revenue');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalize('  hello  ')).toBe('hello');
  });

  it('does not strip internal punctuation', () => {
    expect(normalize('top 10, by revenue')).toBe('top 10, by revenue');
  });

  it('is idempotent', () => {
    const once = normalize('Hello World  ');
    expect(normalize(once)).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// computeCacheKey
// ---------------------------------------------------------------------------

const baseParams = {
  skill: 'explore',
  gameId: 'game-1',
  userText: 'show revenue',
  cubeMetaHash: 'abc123',
  model: 'claude-test',
  systemPromptHash: 'sys456',
};

describe('computeCacheKey', () => {
  it('returns a 64-char hex string', () => {
    const key = computeCacheKey(baseParams);
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  it('same inputs produce same key', () => {
    expect(computeCacheKey(baseParams)).toBe(computeCacheKey(baseParams));
  });

  it('normalizes userText before hashing (case + whitespace)', () => {
    const a = computeCacheKey({ ...baseParams, userText: 'show revenue' });
    const b = computeCacheKey({ ...baseParams, userText: 'SHOW  REVENUE.' });
    expect(a).toBe(b);
  });

  it('different skill → different key', () => {
    const a = computeCacheKey(baseParams);
    const b = computeCacheKey({ ...baseParams, skill: 'diagnose' });
    expect(a).not.toBe(b);
  });

  it('different gameId → different key', () => {
    const a = computeCacheKey(baseParams);
    const b = computeCacheKey({ ...baseParams, gameId: 'game-2' });
    expect(a).not.toBe(b);
  });

  it('different cubeMetaHash → different key', () => {
    const a = computeCacheKey(baseParams);
    const b = computeCacheKey({ ...baseParams, cubeMetaHash: 'changed' });
    expect(a).not.toBe(b);
  });

  it('different model → different key', () => {
    const a = computeCacheKey(baseParams);
    const b = computeCacheKey({ ...baseParams, model: 'claude-opus' });
    expect(a).not.toBe(b);
  });

  it('different systemPromptHash → different key', () => {
    const a = computeCacheKey(baseParams);
    const b = computeCacheKey({ ...baseParams, systemPromptHash: 'newsyshash' });
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// chunkText
// ---------------------------------------------------------------------------

describe('chunkText', () => {
  it('returns empty array for empty string', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('returns single chunk when text <= size', () => {
    expect(chunkText('hello', 80)).toEqual(['hello']);
  });

  it('chunks text at size boundary', () => {
    const text = 'a'.repeat(200);
    const chunks = chunkText(text, 80);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(80);
    expect(chunks[1]).toHaveLength(80);
    expect(chunks[2]).toHaveLength(40);
    expect(chunks.join('')).toBe(text);
  });

  it('uses 80 as default chunk size', () => {
    const text = 'x'.repeat(81);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// sha256
// ---------------------------------------------------------------------------

describe('sha256', () => {
  it('is deterministic', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
  });

  it('returns 64-char hex', () => {
    expect(sha256('test')).toHaveLength(64);
  });
});
