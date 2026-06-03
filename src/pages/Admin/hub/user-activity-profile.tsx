/**
 * UserActivityProfile — the Observability per-user drill-in (/admin/observability/:email).
 *
 * One subject, two lenses under a single identity header + segmented toggle:
 *   Activity → ActivityProfile (vitals + derived session timeline + query shapes)
 *   Access   → AccessControls  (the same govern controls as the Access tab)
 *
 * Reached from the Access tab's "View full activity →" link and from the
 * Observability overview rows. A sub-route (not in-tab state) so the URL is
 * shareable and the browser back-button returns to the overview. tokens.css only.
 */

import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  useAdminRegistry,
  fetchAdminUser,
  type AdminUser,
} from '../access/use-admin-access';
import { ActivityProfile } from './activity-profile';
import { AccessControls } from './access-controls';
import { card } from './per-user-shared';

type Lens = 'activity' | 'access';

function Toggle({ lens, onChange }: { lens: Lens; onChange: (l: Lens) => void }) {
  const opt = (key: Lens, label: string) => {
    const active = lens === key;
    return (
      <button
        type="button"
        onClick={() => onChange(key)}
        style={{
          padding: '6px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
          border: 'none', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-sans)',
          background: active ? 'var(--bg-card)' : 'transparent',
          color: active ? 'var(--text-primary)' : 'var(--text-muted)',
          boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
        }}
        aria-pressed={active}
      >
        {label}
      </button>
    );
  };
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 'var(--radius-md)', background: 'var(--bg-muted)', border: '1px solid var(--border-card)' }}>
      {opt('activity', 'Activity')}
      {opt('access', 'Access')}
    </div>
  );
}

export function UserActivityProfile() {
  const params = useParams<{ email: string }>();
  const email = decodeURIComponent(params.email);
  const [lens, setLens] = useState<Lens>('activity');
  const { registry } = useAdminRegistry();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);

  const loadUser = React.useCallback(() => {
    let stale = false;
    fetchAdminUser(email)
      .then((u) => { if (!stale) { setUser(u); setUserLoaded(true); } })
      .catch(() => { if (!stale) setUserLoaded(true); });
    return () => { stale = true; };
  }, [email]);

  useEffect(() => loadUser(), [loadUser]);

  return (
    <div role="tabpanel" id="hub-tab-panel-observability" aria-labelledby="hub-tab-observability" style={{ marginTop: 16 }}>
      {/* Back-link + lens toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <Link
          to="/admin/observability"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none' }}
        >
          <ArrowLeft size={14} /> All users
        </Link>
        <Toggle lens={lens} onChange={setLens} />
      </div>

      {lens === 'activity' ? (
        <ActivityProfile email={email} />
      ) : user && registry ? (
        <AccessControls user={user} registry={registry} onSaved={loadUser} />
      ) : (
        <div style={{ ...card, padding: 48, textAlign: 'center', fontSize: 14, color: 'var(--text-muted)' }}>
          {!userLoaded ? 'Loading access…' : `No access record found for ${email}.`}
        </div>
      )}
    </div>
  );
}
