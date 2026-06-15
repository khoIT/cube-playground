/**
 * Cross-source links panel — ADVISORY relationships between cubes on different
 * connectors / dataSources. Cube cannot execute these as a live SQL join, so the
 * panel is explicit: every link shows a "not executable" flag plus the path
 * forward (rollupJoin-eligible, or ETL into a shared store). Declared links
 * persist (workspace-scoped) and never compile into a Cube YAML.
 *
 * Self-contained: fetches its own connectors + links so it can drop into the
 * graph view without threading workspace state through the draft engine.
 */
import { ReactElement, useEffect, useState } from 'react';
import { GitBranch, Loader2, AlertTriangle, Trash2, Plus } from 'lucide-react';
import { onboardingClient } from '../../../api/onboarding-client';
import type { Connector, CrossSourceLink } from '../../../api/onboarding-client';

type Relationship = 'many_to_one' | 'one_to_many' | 'one_to_one';

interface Props {
  canWrite: boolean;
}

const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 };
const control: React.CSSProperties = {
  height: 32, width: '100%', padding: '0 9px',
  border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)',
  background: 'var(--bg-app)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', fontSize: 12.5,
};
const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)', padding: 16,
};

export function CrossSourceLinksPanel({ canWrite }: Props): ReactElement {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [links, setLinks] = useState<CrossSourceLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Declare-form state.
  const [leftConnector, setLeftConnector] = useState('');
  const [rightConnector, setRightConnector] = useState('');
  const [leftCube, setLeftCube] = useState('');
  const [rightCube, setRightCube] = useState('');
  const [fromColumn, setFromColumn] = useState('');
  const [toColumn, setToColumn] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('many_to_one');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [c, l] = await Promise.all([onboardingClient.connectors(), onboardingClient.crossSourceLinks()]);
      setConnectors(c.connectors);
      setLinks(l.links);
      setLeftConnector((prev) => prev || c.connectors[0]?.id || '');
      setRightConnector((prev) => prev || c.connectors[1]?.id || c.connectors[0]?.id || '');
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const ready =
    canWrite && leftConnector && rightConnector && leftConnector !== rightConnector &&
    leftCube && rightCube && fromColumn && toColumn && !busy;

  async function declare() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onboardingClient.declareCrossSourceLink({
        leftConnector, rightConnector, leftCube, rightCube,
        key: { fromColumn, toColumn }, relationship, rationale: rationale || undefined,
      });
      setLeftCube(''); setRightCube(''); setFromColumn(''); setToColumn(''); setRationale('');
      setOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setError(null);
    try {
      await onboardingClient.removeCrossSourceLink(id);
      setLinks((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <GitBranch size={15} style={{ color: 'var(--brand)' }} aria-hidden />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Cross-source links</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>advisory · not executable</span>
        {canWrite ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-card)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            <Plus size={13} /> Declare
          </button>
        ) : null}
      </div>

      {error ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', fontSize: 12, marginBottom: 10 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      ) : null}

      {open ? (
        <div style={{ border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, marginBottom: 10 }}>
              <label style={label}>Left connector</label>
              <select style={control} value={leftConnector} onChange={(e) => setLeftConnector(e.target.value)}>
                {connectors.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, marginBottom: 10 }}>
              <label style={label}>Right connector</label>
              <select style={control} value={rightConnector} onChange={(e) => setRightConnector(e.target.value)}>
                {connectors.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </div>
          {leftConnector && leftConnector === rightConnector ? (
            <div style={{ fontSize: 11.5, color: 'var(--warning-ink)', marginBottom: 10 }}>
              Same connector — use an executable join, not a cross-source link.
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, marginBottom: 10 }}>
              <label style={label}>Left cube</label>
              <input style={control} value={leftCube} onChange={(e) => setLeftCube(e.target.value)} placeholder="active_daily" />
            </div>
            <div style={{ flex: 1, marginBottom: 10 }}>
              <label style={label}>Right cube</label>
              <input style={control} value={rightCube} onChange={(e) => setRightCube(e.target.value)} placeholder="af_installs" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, marginBottom: 10 }}>
              <label style={label}>Left key column</label>
              <input style={control} value={fromColumn} onChange={(e) => setFromColumn(e.target.value)} placeholder="user_id" />
            </div>
            <div style={{ flex: 1, marginBottom: 10 }}>
              <label style={label}>Right key column</label>
              <input style={control} value={toColumn} onChange={(e) => setToColumn(e.target.value)} placeholder="customer_user_id" />
            </div>
            <div style={{ width: 140, marginBottom: 10 }}>
              <label style={label}>Relationship</label>
              <select style={control} value={relationship} onChange={(e) => setRelationship(e.target.value as Relationship)}>
                <option value="many_to_one">many_to_one</option>
                <option value="one_to_many">one_to_many</option>
                <option value="one_to_one">one_to_one</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={label}>Rationale</label>
            <input style={control} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="why these connect (attribution overlay, shared user key…)" />
          </div>
          <button
            type="button"
            onClick={declare}
            disabled={!ready}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--brand)', color: 'var(--text-on-brand)', fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600, cursor: ready ? 'pointer' : 'not-allowed', opacity: ready ? 1 : 0.5 }}
          >
            {busy ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Declare link
          </button>
        </div>
      ) : null}

      {loading ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Loading links…</div>
      ) : links.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          No cross-source links declared. These document intent across dataSources Cube can’t join live.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {links.map((l) => (
            <div key={l.id} style={{ border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)' }}>
                  {l.leftConnector}.{l.leftCube} ⇢ {l.rightConnector}.{l.rightCube}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.relationship}</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                  <Badge tone="destructive">not executable</Badge>
                  {l.verdict?.rollupJoinEligible ? <Badge tone="info">rollupJoin-eligible</Badge> : <Badge tone="warning">ETL path</Badge>}
                  {canWrite ? (
                    <button type="button" onClick={() => remove(l.id)} title="Remove link" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}>
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                key: {l.key.fromColumn} → {l.key.toColumn}
                {l.rationale ? ` · ${l.rationale}` : ''}
              </div>
              {l.verdict ? <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{l.verdict.note}</div> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: 'destructive' | 'warning' | 'info'; children: React.ReactNode }): ReactElement {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 'var(--radius-pill)', background: `var(--${tone}-soft)`, color: `var(--${tone}-ink)` }}>
      {children}
    </span>
  );
}
