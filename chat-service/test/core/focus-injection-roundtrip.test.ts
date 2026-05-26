/**
 * Phase 02 — focus snapshot round-trips into the next turn's system prompt.
 *
 * Scenario: turn 1 wrote `{metric, timeRange, filter:country=VN}` to focus.
 * Turn 2's compose() pulls focus from the same session id and the resulting
 * system prompt embeds the `## Conversation focus` block — including the
 * field-chip token form for the metric so the FE renders a clickable chip.
 *
 * Confirms compose() with a missing focus stays identical to the pre-phase-02
 * shape (no `## Conversation focus` heading appears).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import { compose } from '../../src/core/mode-prompts.js';
import { mergeFocus, getFocus } from '../../src/cache/session-focus-adapter.js';
import { config } from '../../src/config.js';

const SID = 'sess-focus-rt';
const OWNER = 'owner-a';

beforeEach(() => {
  (config as { cacheServiceEnabled: boolean; chatContextFocusStoreEnabled: boolean })
    .cacheServiceEnabled = true;
  (config as { cacheServiceEnabled: boolean; chatContextFocusStoreEnabled: boolean })
    .chatContextFocusStoreEnabled = true;
});

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('focus injection roundtrip', () => {
  it('focus written in turn 1 lands in turn 2 system prompt', () => {
    const db = makeDb();
    mergeFocus(db, SID, OWNER, {
      metric: { value: 'recharge.revenue_vnd', phrase: 'revenue' },
      timeRange: {
        value: { dateRange: ['2026-05-19', '2026-05-26'], granularity: 'day' },
        phrase: 'last 7 days',
      },
      filters: { 'players.country': { value: 'VN', phrase: 'Vietnam' } },
      artifactRef: { value: 'artifact:abc' },
    });

    const focus = getFocus(db, SID);
    const { systemPrompt } = compose({
      skill: 'explore',
      game: 'ptg',
      focus,
    });

    expect(systemPrompt).toContain('## Conversation focus');
    expect(systemPrompt).toContain('{{field:recharge.revenue_vnd}}');
    expect(systemPrompt).toContain('last 7 days');
    expect(systemPrompt).toContain('players.country = VN');
    expect(systemPrompt).toContain('artifact:abc');
  });

  it('compose() with no focus produces no `## Conversation focus` block', () => {
    const { systemPrompt } = compose({ skill: 'explore', game: 'ptg' });
    expect(systemPrompt).not.toContain('## Conversation focus');
  });

  it('compose() with empty focus bag skips the block', () => {
    const { systemPrompt } = compose({ skill: 'explore', game: 'ptg', focus: {} });
    expect(systemPrompt).not.toContain('## Conversation focus');
  });

  it('focus survives compose() called twice on the same db', () => {
    const db = makeDb();
    mergeFocus(db, SID, OWNER, { metric: { value: 'm.x' } });

    const focus1 = getFocus(db, SID);
    const focus2 = getFocus(db, SID);
    const sp1 = compose({ skill: 'explore', game: 'ptg', focus: focus1 }).systemPrompt;
    const sp2 = compose({ skill: 'explore', game: 'ptg', focus: focus2 }).systemPrompt;
    expect(sp1).toBe(sp2);
  });
});
