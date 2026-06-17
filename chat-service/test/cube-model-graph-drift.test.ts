import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Drift guard: the chat-service join-graph builder is a byte-identical vendored
 * copy of the FE Catalog builder. They can't share one file — chat-service
 * builds and ships standalone (its Docker image has no FE source) — so this
 * test is the deterministic "no drift" enforcement: edit one copy and forget
 * the other, this fails. Skips gracefully when the FE source isn't present
 * (e.g. inside the chat-service-only Docker build), where the guard is moot.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDORED = resolve(__dirname, '../src/shared/cube-model-graph/build-join-graph.ts');
const FE_CANONICAL = resolve(
  __dirname,
  '../../src/pages/Catalog/cube-graph/build-join-graph.ts',
);

describe('cube-model-graph vendored copy', () => {
  it('stays byte-identical to the FE Catalog builder', () => {
    expect(existsSync(VENDORED)).toBe(true);
    if (!existsSync(FE_CANONICAL)) {
      // FE source absent (standalone build context) — guard is not applicable.
      return;
    }
    const vendored = readFileSync(VENDORED, 'utf8');
    const canonical = readFileSync(FE_CANONICAL, 'utf8');
    expect(vendored).toBe(canonical);
  });
});
