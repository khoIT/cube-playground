/**
 * The member-row redaction guard: only opaque identity keys, numeric metrics,
 * and reachability flags survive into agent context. Names/emails/contact never
 * do — even if numeric-looking.
 */
import { describe, it, expect } from 'vitest';
import {
  redactMemberRow,
  redactMemberRows,
  stripPiiColumns,
} from '../src/advisor/agent/agent-redaction-guard.js';

describe('redactMemberRow', () => {
  it('keeps user_id, numeric metrics, and reachability; drops names/emails', () => {
    const r = redactMemberRow({
      user_id: 'abc123',
      ltv_vnd: 5_000_000,
      sessions: '42',
      reachable: true,
      email: 'a@b.com',
      ingame_name: 'DragonSlayer',
      full_name: 'Nguyen Van A',
    });
    expect(r).toHaveProperty('user_id', 'abc123');
    expect(r).toHaveProperty('ltv_vnd', 5_000_000);
    expect(r).toHaveProperty('sessions', '42');
    expect(r).toHaveProperty('reachable', true);
    expect(r).not.toHaveProperty('email');
    expect(r).not.toHaveProperty('ingame_name');
    expect(r).not.toHaveProperty('full_name');
  });

  it('drops a denylisted key even when its value is numeric (e.g. phone)', () => {
    const r = redactMemberRow({ user_id: 'u', phone: '84901234567' });
    expect(r).toHaveProperty('user_id');
    expect(r).not.toHaveProperty('phone');
  });

  it('leaves no contact PII keys across a batch', () => {
    const rows = redactMemberRows([
      { user_id: 'u1', email: 'x@y.com', spend: 10 },
      { user_id: 'u2', name: 'Bob', spend: 20 },
    ]);
    const keys = new Set(rows.flatMap((r) => Object.keys(r)));
    expect(keys.has('email')).toBe(false);
    expect(keys.has('name')).toBe(false);
    expect(keys.has('user_id')).toBe(true);
    expect(keys.has('spend')).toBe(true);
  });
});

describe('stripPiiColumns', () => {
  it('keeps analytical dimensions but drops contact columns', () => {
    const rows = stripPiiColumns([{ country: 'VN', payers: 1200, email: 'x@y.com' }]);
    expect(rows[0]).toHaveProperty('country', 'VN'); // dimension survives
    expect(rows[0]).toHaveProperty('payers', 1200);
    expect(rows[0]).not.toHaveProperty('email');
  });

  it('drops fully-qualified Cube PII keys (mf_users.ingame_name / .user_email)', () => {
    const rows = stripPiiColumns([
      {
        'mf_users.ingame_name': 'DragonSlayer',
        'mf_users.user_email': 'x@y.com',
        'mf_users.recharge_phone': '84901234567',
        'mf_users.payers': 1200,
        'mf_users.game_name': 'CFM', // legit dimension — must survive
      },
    ]);
    expect(rows[0]).not.toHaveProperty('mf_users.ingame_name');
    expect(rows[0]).not.toHaveProperty('mf_users.user_email');
    expect(rows[0]).not.toHaveProperty('mf_users.recharge_phone');
    expect(rows[0]).toHaveProperty('mf_users.payers', 1200);
    expect(rows[0]).toHaveProperty('mf_users.game_name', 'CFM');
  });
});

describe('redactMemberRow dotted keys', () => {
  it('drops dotted identity/contact keys, keeps dotted numeric metrics', () => {
    const r = redactMemberRow({
      'mf_users.user_id': 'u1',
      'mf_users.ingame_name': 'X',
      'mf_users.msisdn': 84900000000,
      'mf_users.ltv_vnd': 5_000_000,
    });
    expect(r).toHaveProperty('mf_users.user_id');
    expect(r).toHaveProperty('mf_users.ltv_vnd', 5_000_000);
    expect(r).not.toHaveProperty('mf_users.ingame_name');
    expect(r).not.toHaveProperty('mf_users.msisdn'); // numeric PII still denied
  });
});
