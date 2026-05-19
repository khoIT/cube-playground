import { describe, it, expect } from 'vitest';
import { pickIdentityField } from '../src/services/identity-suggester.js';
import { mergeIdentityRows } from '../src/routes/identity-map.js';

describe('pickIdentityField', () => {
  it('matches .user_id over .uid', () => {
    const out = pickIdentityField([
      { name: 'mf_users.uid' },
      { name: 'mf_users.user_id' },
    ]);
    expect(out.identity_field).toBe('mf_users.user_id');
    expect(out.matched_pattern).toBe('user_id');
  });

  it('falls back to .uid', () => {
    const out = pickIdentityField([{ name: 'mf_events.uid' }]);
    expect(out.identity_field).toBe('mf_events.uid');
    expect(out.matched_pattern).toBe('uid');
  });

  it('returns null when no identity-shaped dim is found', () => {
    const out = pickIdentityField([
      { name: 'cube.foo' },
      { name: 'cube.bar' },
    ]);
    expect(out.identity_field).toBeNull();
    expect(out.confidence).toBe(0);
  });

  it('prefers player_id over customer_id', () => {
    const out = pickIdentityField([
      { name: 'mf_users.customer_id' },
      { name: 'mf_users.player_id' },
    ]);
    expect(out.identity_field).toBe('mf_users.player_id');
  });
});

describe('mergeIdentityRows', () => {
  it('persisted override wins over auto-suggest', () => {
    const merged = mergeIdentityRows(
      [
        { cube: 'mf_users', identity_field: 'mf_users.alt_id', source: 'manual', confidence: 1, updated_at: 't' },
      ],
      [
        { cube: 'mf_users', identity_field: 'mf_users.user_id', confidence: 0.95, matched_pattern: 'user_id' },
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].identity_field).toBe('mf_users.alt_id');
    expect(merged[0].source).toBe('manual');
    expect(merged[0].is_suggested).toBe(false);
  });

  it('unmapped cubes get is_suggested=true', () => {
    const merged = mergeIdentityRows(
      [],
      [
        { cube: 'mf_users', identity_field: 'mf_users.user_id', confidence: 0.95, matched_pattern: 'user_id' },
      ],
    );
    expect(merged[0].source).toBe('auto-suggest');
    expect(merged[0].is_suggested).toBe(true);
  });

  it('persisted-only rows (cube dropped from meta) still surface', () => {
    const merged = mergeIdentityRows(
      [
        { cube: 'gone_cube', identity_field: 'gone_cube.x', source: 'manual', confidence: 1, updated_at: 't' },
      ],
      [],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].cube).toBe('gone_cube');
  });
});
