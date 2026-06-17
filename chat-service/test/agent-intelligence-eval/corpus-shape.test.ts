/**
 * Deterministic guard for the agent-intelligence eval corpus (P6). The live
 * runner is manual (needs the OAuth+Cube lane), but the corpus itself is a
 * committed artifact — this test keeps it well-formed and ensures it covers
 * every category the success criteria depend on, so CI catches drift without
 * an LLM. The behavioural sub-checks live in the grain-gate / smart-defaults /
 * resolved-context unit tests.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(resolve(__dirname, 'corpus.json'), 'utf8')) as {
  game: string;
  prompts: Array<{ id: string; category: string; prompt: string }>;
};

const REQUIRED_CATEGORIES = [
  'ranking-individual',
  'ranking-group',
  'trend',
  'compare',
  'recovery',
  'follow-up',
  'rephrase',
];

describe('agent-intelligence eval corpus', () => {
  it('declares a game and a non-empty prompt list', () => {
    expect(corpus.game).toBeTruthy();
    expect(corpus.prompts.length).toBeGreaterThan(0);
  });

  it('every prompt has a unique id, category, and prompt text', () => {
    const ids = new Set<string>();
    for (const p of corpus.prompts) {
      expect(p.id, 'id').toBeTruthy();
      expect(p.prompt, `prompt for ${p.id}`).toBeTruthy();
      expect(p.category, `category for ${p.id}`).toBeTruthy();
      expect(ids.has(p.id), `duplicate id ${p.id}`).toBe(false);
      ids.add(p.id);
    }
  });

  it('covers every success-criteria category', () => {
    const present = new Set(corpus.prompts.map((p) => p.category));
    for (const cat of REQUIRED_CATEGORIES) {
      expect(present.has(cat), `missing category: ${cat}`).toBe(true);
    }
  });
});
