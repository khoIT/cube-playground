import { describe, it, expect } from 'vitest';
import { buildScopedEnv, buildRestoredEnv, SCOPE_LABEL } from '../src/services/preagg-worker-scope-env.js';

const BASE_ENV = [
  'CUBEJS_DEV_MODE=false',
  'CUBEJS_SCHEDULED_REFRESH_TIMER=300',
  'CUBEJS_LOG_LEVEL=info',
  'CUBEJS_DB_TYPE=trino',
];

describe('buildScopedEnv', () => {
  it('overrides the scope trio and preserves everything else', () => {
    const { env } = buildScopedEnv(BASE_ENV, 'jus', 20);
    expect(env).toContain('CUBE_REFRESH_GAMES=jus');
    expect(env).toContain('CUBEJS_SCHEDULED_REFRESH_TIMER=20');
    expect(env).toContain('CUBEJS_LOG_LEVEL=trace');
    expect(env).toContain('CUBEJS_DEV_MODE=false');
    expect(env).toContain('CUBEJS_DB_TYPE=trino');
    // no duplicate keys left behind
    expect(env.filter((e) => e.startsWith('CUBEJS_SCHEDULED_REFRESH_TIMER='))).toHaveLength(1);
    expect(env.filter((e) => e.startsWith('CUBEJS_LOG_LEVEL='))).toHaveLength(1);
  });

  it('records the original trio (null for keys not present) in the label value', () => {
    const { originalLabelValue } = buildScopedEnv(BASE_ENV, 'jus', 20);
    expect(JSON.parse(originalLabelValue)).toEqual({
      CUBE_REFRESH_GAMES: null,
      CUBEJS_SCHEDULED_REFRESH_TIMER: '300',
      CUBEJS_LOG_LEVEL: 'info',
    });
  });
});

describe('buildRestoredEnv', () => {
  it('round-trips: restore(scope(env)) === env (order-insensitive)', () => {
    const { env: scoped, originalLabelValue } = buildScopedEnv(BASE_ENV, 'jus', 20);
    const restored = buildRestoredEnv(scoped, originalLabelValue);
    expect([...restored].sort()).toEqual([...BASE_ENV].sort());
  });

  it('drops keys whose original value was null instead of restoring empties', () => {
    const { env: scoped, originalLabelValue } = buildScopedEnv(BASE_ENV, 'jus', 20);
    const restored = buildRestoredEnv(scoped, originalLabelValue);
    expect(restored.some((e) => e.startsWith('CUBE_REFRESH_GAMES='))).toBe(false);
  });

  it('throws on a malformed label so callers never recreate with a guessed config', () => {
    expect(() => buildRestoredEnv(BASE_ENV, 'not-json')).toThrow();
  });
});

describe('SCOPE_LABEL', () => {
  it('is a stable docker-label key', () => {
    expect(SCOPE_LABEL).toBe('playground.preagg.scoped-original-env');
  });
});
