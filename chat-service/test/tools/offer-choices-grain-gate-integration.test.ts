/**
 * Integration test for the free-form grain gate WIRING (P5 follow-up):
 * offer_choices handler + resolved-entity memory + glossary + flag, end to end
 * (minus the LLM). Proves that when a session has an individual ranking entity
 * pinned and the flag is on, the emitted chip frame has its ratio metrics
 * stripped — and that it's inert when the flag is off or the grain is unknown.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';

const GLOSSARY: OfficialTerm[] = [
  { id: 'revenue', label: 'Revenue', refKind: 'measure', measureRef: 'm.rev', category: 'revenue' },
  { id: 'arpu', label: 'ARPU', refKind: 'measure', measureRef: 'mf_users.arpu_vnd', category: 'monetisation' },
  { id: 'arpdau', label: 'ARPDAU', refKind: 'ratio', ratioRef: 'a/b', category: 'monetisation' },
  { id: 'ltv', label: 'LTV', refKind: 'ratio', ratioRef: 'c/d', category: 'monetisation' },
].map((t) => ({ labelVi: null, description: '', primaryCatalogId: null, aliases: [], aliasesVi: [], ...t }) as OfficialTerm);

vi.mock('../../src/nl-to-query/glossary-client.js', () => ({
  fetchOfficialGlossary: async () => GLOSSARY,
}));

import { handler } from '../../src/tools/offer-choices.js';
import { migrate } from '../../src/db/migrate.js';
import { mergeResolution } from '../../src/cache/disambig-memory-adapter.js';
import { config } from '../../src/config.js';
import type { ToolContext } from '../../src/types.js';

interface Frame { slot: string; options: Array<{ label: string }> }

function ctxWith(db: Database.Database, emitter: EventEmitter): ToolContext {
  return {
    ownerId: 'o', gameId: 'cfm_vn', cubeToken: 't', workspace: 'local',
    sessionId: 'sess-grain', turnId: 'sess-grain:1', sseEmitter: emitter, db,
  };
}

const OPTS = [
  { label: 'Revenue', pinText: 'Rank top spenders by Revenue.' },
  { label: 'LTV', pinText: 'Rank top spenders by LTV.' },
  { label: 'ARPDAU', pinText: 'Rank top spenders by ARPDAU.' },
  { label: 'ARPU', pinText: 'Rank top spenders by ARPU.' },
];

async function emittedLabels(db: Database.Database): Promise<string[]> {
  const emitter = new EventEmitter();
  const frames: Frame[] = [];
  emitter.on('disambig_options', (d: Frame) => frames.push(d));
  await handler({ prompt: 'Which metric?', options: OPTS }, ctxWith(db, emitter));
  return frames[0].options.map((o) => o.label);
}

describe('offer_choices grain gate (wiring)', () => {
  let db: Database.Database;
  let prevFlag: boolean;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db);
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
    prevFlag = config.agentEngineRouting;
  });
  afterEach(() => {
    (config as { agentEngineRouting: boolean }).agentEngineRouting = prevFlag;
    db.close();
  });

  it('strips ratio chips when an individual entity is resolved AND the flag is on', async () => {
    mergeResolution(db, 'sess-grain', 'o', { entity: { value: { cube: 'players', pk: 'players.user_id' } } });
    (config as { agentEngineRouting: boolean }).agentEngineRouting = true;
    expect(await emittedLabels(db)).toEqual(['Revenue', 'ARPU']); // LTV + ARPDAU dropped
  });

  it('is inert when the flag is off (default) even with an individual entity', async () => {
    mergeResolution(db, 'sess-grain', 'o', { entity: { value: { cube: 'players', pk: 'players.user_id' } } });
    (config as { agentEngineRouting: boolean }).agentEngineRouting = false;
    expect(await emittedLabels(db)).toEqual(['Revenue', 'LTV', 'ARPDAU', 'ARPU']);
  });

  it('is inert when no entity is resolved (grain unknown → fail-safe)', async () => {
    (config as { agentEngineRouting: boolean }).agentEngineRouting = true;
    expect(await emittedLabels(db)).toEqual(['Revenue', 'LTV', 'ARPDAU', 'ARPU']);
  });
});
