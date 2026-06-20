/**
 * Tests for the get_company_context tool handler — serves the curated VNGGames
 * company + Game Publishing Platform overview from the shipped seed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ToolContext } from '../src/types.js';
import { handler } from '../src/tools/get-company-context.js';
import { __resetPlatformContextCache } from '../src/db/platform-context-seed.js';

function makeCtx(): ToolContext {
  return {
    ownerId: 'owner1',
    gameId: 'cfm_vn',
    cubeToken: 'Bearer tok',
    workspace: 'local',
    sessionId: 'sess-1',
    turnId: 'sess-1:1',
    sseEmitter: new EventEmitter(),
  };
}

beforeEach(() => {
  __resetPlatformContextCache();
});

describe('get_company_context handler', () => {
  it('returns the full overview when no args given', async () => {
    const result = (await handler({}, makeCtx())) as Record<string, any>;
    expect(result.found).toBe(true);
    expect(result.company?.name).toBe('VNGGames');
    expect(result.platform?.name).toContain('Game Publishing Platform');
    expect(Array.isArray(result.platform?.domains)).toBe(true);
    expect(result.platform.domains.length).toBeGreaterThanOrEqual(8);
    expect(Array.isArray(result.glossary)).toBe(true);
  });

  it('scopes to a single section', async () => {
    const company = (await handler({ section: 'company' }, makeCtx())) as Record<string, any>;
    expect(company.found).toBe(true);
    expect(company.company?.name).toBe('VNGGames');
    expect(company.platform).toBeUndefined();
    expect(company.glossary).toBeUndefined();

    const glossary = (await handler({ section: 'glossary' }, makeCtx())) as Record<string, any>;
    expect(glossary.glossary.some((t: any) => t.term === 'GS')).toBe(true);
  });

  it('drills into a product by key, name, or alias', async () => {
    const byKey = (await handler({ product: 'apollo' }, makeCtx())) as Record<string, any>;
    expect(byKey.found).toBe(true);
    expect(byKey.product?.key).toBe('apollo');

    const byAlias = (await handler({ product: 'Level Up' }, makeCtx())) as Record<string, any>;
    expect(byAlias.found).toBe(true);
    expect(byAlias.product?.key).toBe('level_up');

    const byPartial = (await handler({ product: 'GDS' }, makeCtx())) as Record<string, any>;
    expect(byPartial.found).toBe(true);
    expect(byPartial.product?.key).toBe('gds');
  });

  it('reports an unmatched product with the known list', async () => {
    const result = (await handler({ product: 'nonexistent_product' }, makeCtx())) as Record<string, any>;
    expect(result.found).toBe(false);
    expect(Array.isArray(result.known_products)).toBe(true);
    expect(result.known_products).toContain('Nexus');
  });

  it('product drill takes precedence over section', async () => {
    const result = (await handler(
      { section: 'company', product: 'pay' },
      makeCtx(),
    )) as Record<string, any>;
    expect(result.found).toBe(true);
    expect(result.product?.key).toBe('pay');
    expect(result.company).toBeUndefined();
  });
});
