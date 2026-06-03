/**
 * FeatureAccessSection — grouped feature-grant toggles with override pills.
 *
 * Extracted from access-controls.tsx to keep each module focused. Groups feature
 * keys into Analyst surfaces (default on) / Admin governance (default off) and
 * lets an admin override per-feature; an explicit per-user entry renders an
 * "override" badge. Saves the full feature map in one PUT. tokens.css only.
 */

import React from 'react';
import type { AdminUser, AdminRegistry } from '../access/use-admin-access';
import { putAdminUserFeatures } from '../access/use-admin-access';
import { useGrantSection } from '../access/use-grant-section';
import { groupFeatures, FEATURE_LABEL } from './per-user-panel-helpers';
import { card, eyebrow, saveBtnStyle } from './per-user-shared';

export function FeatureAccessSection({ user, registry, onSaved }: { user: AdminUser; registry: AdminRegistry; onSaved: (email: string) => void }) {
  const groups = groupFeatures(registry, user);

  const initSelected = registry.featureKeys.filter((k) => {
    const allEntries = groups.flatMap((g) => g.entries);
    return allEntries.find((e) => e.key === k)?.active ?? false;
  });

  const feats = useGrantSection(
    initSelected,
    (ids) => {
      const next: Record<string, boolean> = {};
      for (const key of registry.featureKeys) next[key] = ids.includes(key);
      return putAdminUserFeatures(user.email, next);
    },
    () => onSaved(user.email),
  );

  return (
    <section style={card}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Feature access</span>
        <button type="button" onClick={feats.save} disabled={feats.saving} style={saveBtnStyle(feats.saving)}>
          {feats.saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {groups.map((group) => (
          <div key={group.area}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <span style={eyebrow}>{group.area}</span>
              <span
                style={{
                  fontSize: 10.5, padding: '1px 7px', borderRadius: 'var(--radius-full)',
                  background: group.defaultOn ? 'var(--success-soft)' : 'var(--warning-soft)',
                  color: group.defaultOn ? 'var(--success-ink)' : 'var(--warning-ink)',
                  fontWeight: 600,
                }}
              >
                {group.defaultOn ? 'default on' : 'default off'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {group.entries.map((entry) => {
                const checked = feats.selected.has(entry.key);
                return (
                  <label
                    key={entry.key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)', fontSize: 13,
                      background: checked ? 'var(--bg-muted)' : 'transparent',
                      cursor: 'pointer', userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => feats.toggle(entry.key, e.target.checked)}
                      style={{ accentColor: 'var(--brand)', cursor: 'pointer' }}
                    />
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {FEATURE_LABEL[entry.key] ?? entry.key}
                    </span>
                    {entry.override && (
                      <span
                        style={{
                          fontSize: 10, color: 'var(--info-ink)', background: 'var(--info-soft)',
                          padding: '0 6px', borderRadius: 'var(--radius-full)', fontWeight: 600,
                        }}
                      >
                        override
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {(feats.saved || feats.error) && (
        <div
          style={{
            padding: '8px 14px', fontSize: 12, fontWeight: 500,
            borderTop: '1px solid var(--border-card)',
            background: feats.error ? 'var(--destructive-soft)' : 'var(--success-soft)',
            color: feats.error ? 'var(--destructive-ink)' : 'var(--success-ink)',
          }}
        >
          {feats.error ?? 'Saved.'}
        </div>
      )}
    </section>
  );
}
