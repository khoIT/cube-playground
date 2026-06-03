/**
 * observability-data pure helpers — CSV serialization + audit query string.
 * Locks the export contract (escaping, header, no-PII detail column) and the
 * filter→querystring mapping the audit-log viewer relies on.
 */

import { describe, it, expect } from 'vitest';
import { auditEntriesToCsv, auditQueryString, type AuditEntry } from '../observability-data';

const ENTRY = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 1,
  actorEmail: 'admin@corp.com',
  action: 'set_role',
  targetEmail: 'bob@corp.com',
  detail: { role: 'editor' },
  ts: '2026-06-01T10:00:00.000Z',
  ...over,
});

describe('auditQueryString', () => {
  it('omits empty filters', () => {
    expect(auditQueryString({})).toBe('');
  });

  it('builds a querystring from set filters', () => {
    const qs = auditQueryString({ actor: 'admin', action: 'set_role', limit: 50 });
    expect(qs.startsWith('?')).toBe(true);
    expect(qs).toContain('actor=admin');
    expect(qs).toContain('action=set_role');
    expect(qs).toContain('limit=50');
  });

  it('url-encodes filter values', () => {
    expect(auditQueryString({ target: 'a b@x.com' })).toContain('target=a+b%40x.com');
  });
});

describe('auditEntriesToCsv', () => {
  it('emits a header row + one row per entry', () => {
    const csv = auditEntriesToCsv([ENTRY(), ENTRY({ id: 2, action: 'set_games' })]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('id,ts,actor,action,target,detail');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('set_role');
    expect(lines[2]).toContain('set_games');
  });

  it('serializes the detail column as JSON', () => {
    const csv = auditEntriesToCsv([ENTRY({ detail: { games: ['muaw', 'huashu'] } })]);
    // commas inside JSON force quoting + the JSON quotes get doubled
    expect(csv).toContain('"{""games"":[""muaw"",""huashu""]}"');
  });

  it('renders null detail as an empty cell', () => {
    const csv = auditEntriesToCsv([ENTRY({ detail: null })]);
    expect(csv.split('\n')[1].endsWith(',')).toBe(true);
  });

  it('escapes a field containing a comma', () => {
    const csv = auditEntriesToCsv([ENTRY({ action: 'a,b' })]);
    expect(csv).toContain('"a,b"');
  });
});
