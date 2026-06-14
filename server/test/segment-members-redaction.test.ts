/**
 * redactSensitiveMembers — the tokenless members pull must never serve
 * monetization / CS / VIP columns to an unauthenticated caller (a token-free
 * payer/CS dossier). uid + non-sensitive columns stay (the CS-tooling contract).
 * The pre-existing ltv rank-measure exposure on mf_users is intentionally kept.
 */
import { describe, it, expect } from 'vitest';
import { redactSensitiveMembers } from '../src/routes/segments.js';

const payload = () => ({
  total_count: 1,
  columns: [
    { key: 'name', label: 'Name', field: 'mf_users.ingame_name' },
    { key: 'ltv', label: 'LTV', field: 'mf_users.ltv_total_vnd' }, // pre-existing rank measure — NOT gated
    { key: 'cash', label: 'Cash', field: 'user_billing_detail_panel.cash_charged_gross' },
    { key: 'life', label: 'Lifetime', field: 'user_billing_lifetime_panel.lifetime_vnd' },
    { key: 'vip', label: 'VIP', field: 'user_cs_tickets_panel.vip_id' },
    { key: 'csat', label: 'CSAT', field: 'user_cs_tickets_panel.ticket_rating' },
  ],
  members: [
    { uid: 'u1', name: 'A', ltv: 9000, cash: 500, life: 88000, vip: 7, csat: 4 },
  ],
});

describe('redactSensitiveMembers', () => {
  it('passes through unchanged for an authenticated caller', () => {
    const p = payload();
    expect(redactSensitiveMembers(p, true)).toBe(p);
  });

  it('strips monetization/CS/VIP columns for an unauthenticated caller; keeps uid + name + ltv', () => {
    const out = redactSensitiveMembers(payload(), false) as ReturnType<typeof payload> & {
      redacted_columns: string[];
    };
    expect(out.columns.map((c) => c.key)).toEqual(['name', 'ltv']);
    expect(out.members[0]).toEqual({ uid: 'u1', name: 'A', ltv: 9000 });
    expect(out.redacted_columns).toEqual(
      expect.arrayContaining([
        'user_billing_detail_panel.cash_charged_gross',
        'user_billing_lifetime_panel.lifetime_vnd',
        'user_cs_tickets_panel.vip_id',
        'user_cs_tickets_panel.ticket_rating',
      ]),
    );
  });

  it('is a no-op when no sensitive columns are present', () => {
    const p = {
      columns: [{ key: 'name', label: 'Name', field: 'mf_users.ingame_name' }],
      members: [{ uid: 'u1', name: 'A' }],
    };
    expect(redactSensitiveMembers(p, false)).toBe(p);
  });
});
