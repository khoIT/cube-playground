/**
 * Unit tests for the source-type registry: every introspectable type has a valid
 * field schema, and input validation correctly splits the secret from config.
 */
import { describe, it, expect } from 'vitest';
import {
  SOURCE_TYPES,
  getSourceType,
  validateConnectionInput,
} from '../src/services/source-type-registry.js';

describe('source-type-registry', () => {
  it('every source type declares exactly one secret field (or none) + caps', () => {
    for (const st of SOURCE_TYPES) {
      const secretFields = st.fields.filter((f) => f.secret);
      expect(secretFields.length, `${st.id} secret fields`).toBeLessThanOrEqual(1);
      expect(st.driverType).toBeTruthy();
      expect(st.caps).toHaveProperty('introspect');
    }
  });

  it('marks the warehouse SQL family as introspectable', () => {
    for (const id of ['trino', 'postgres', 'mysql', 'redshift']) {
      expect(getSourceType(id)?.caps.introspect, id).toBe(true);
    }
  });

  it('validates a postgres connection and splits secret from config', () => {
    const res = validateConnectionInput('postgres', {
      host: 'pg.internal',
      port: '5432',
      catalog: 'analytics',
      user: 'svc',
      password: 'p@ss',
      ssl: 'true',
    });
    expect(res.ok).toBe(true);
    expect(res.driverType).toBe('postgres');
    expect(res.secret).toBe('p@ss');
    expect(res.config).toMatchObject({ host: 'pg.internal', port: 5432, catalog: 'analytics', user: 'svc', ssl: true });
    // secret never leaks into config
    expect(JSON.stringify(res.config)).not.toContain('p@ss');
  });

  it('reports missing required fields', () => {
    const res = validateConnectionInput('postgres', { host: 'pg.internal' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/Database|User/);
    expect(res.config).toEqual({});
  });

  it('rejects an unknown source type', () => {
    const res = validateConnectionInput('mystery-db', { host: 'x' });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/unknown source type/);
  });

  it('coerces number + boolean fields and applies defaults', () => {
    const res = validateConnectionInput('postgres', {
      host: 'pg.internal',
      catalog: 'analytics',
      user: 'svc',
      // omit port + ssl → defaults apply
    });
    expect(res.ok).toBe(true);
    expect(res.config.port).toBe(5432);
    expect(res.config.ssl).toBe(true);
  });
});
