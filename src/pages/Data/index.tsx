/**
 * /data — the Data hub: a workspace-scoped list of connectors that cube-
 * playground can model, the entry point to the cube-model onboarding agent.
 * Internal step state (list → add catalog → connect form → connector detail →
 * triage) is kept here so a single /data route hosts the whole flow, the same
 * way DriftCenter is a single page. Page-header recipe + tokens per
 * docs/design-guidelines.md; mirrors src/pages/Dashboards/index.tsx.
 */
import React, { useEffect, useState } from 'react';
import { Database, RefreshCw, ArrowLeft } from 'lucide-react';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useWorkspaceContext } from '../../components/workspace-context';
import { useAuthUser } from '../../auth/auth-context';
import { onboardingClient } from '../../api/onboarding-client';
import type { Connector } from '../../api/onboarding-client';
import { ConnectorsList } from './connectors-list';
import { AddConnector } from './add-connector';
import { ConnectorCredentials } from './connector-connect-form';
import { ConnectorDetail } from './connector-detail';
import { CrossSourceLinksPanel } from './triage/cross-source-links-panel';

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1100,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};
const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  marginBottom: 8,
};
const titleRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' };
const ledeStyle: React.CSSProperties = { margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)', maxWidth: '64ch' };
const ghostBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 30,
  padding: '0 12px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-sans)',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
};
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'var(--brand)',
  color: 'var(--text-on-brand, #fff)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: '7px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

type Step =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'connect'; source: { id: string; label: string } }
  | { kind: 'detail'; connector: Connector };

export function DataHubPage(): React.ReactElement {
  const gameId = useActiveGameId();
  const { workspaceId } = useWorkspaceContext();
  const user = useAuthUser();
  const canWrite = user ? user.role !== 'viewer' : true;

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'list' });

  async function load() {
    setLoading(true);
    try {
      const res = await onboardingClient.connectors();
      setConnectors(res.connectors);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Re-fetch when the workspace changes (connectors are workspace-scoped).
  useEffect(() => {
    void load();
    setStep({ kind: 'list' });
  }, [workspaceId]);

  return (
    <div style={pageStyle}>
      <div style={eyebrowStyle}>
        Data{workspaceId ? ` · workspace: ${workspaceId}` : ''}
        {gameId ? ` · ${gameId}` : ''}
      </div>

      {step.kind === 'detail' ? (
        <ConnectorDetail
          connector={step.connector}
          onBack={() => {
            setStep({ kind: 'list' });
            void load(); // reflect edits / disables made in the detail view
          }}
        />
      ) : (
        <>
          <div style={titleRow}>
            <Database size={20} style={{ color: 'var(--brand)' }} aria-hidden />
            <h1 style={titleStyle}>
              {step.kind === 'add'
                ? 'Add data connector'
                : step.kind === 'connect'
                  ? `Connect ${step.source.label}`
                  : 'Data connectors'}
            </h1>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {step.kind === 'list' ? (
                <>
                  <button type="button" style={ghostBtn} onClick={() => void load()} disabled={loading}>
                    <RefreshCw size={14} /> Refresh
                  </button>
                  {canWrite ? (
                    <button type="button" style={primaryBtn} onClick={() => setStep({ kind: 'add' })}>
                      + Add connector
                    </button>
                  ) : null}
                </>
              ) : (
                <button
                  type="button"
                  style={ghostBtn}
                  onClick={() => setStep(step.kind === 'connect' ? { kind: 'add' } : { kind: 'list' })}
                >
                  <ArrowLeft size={14} /> Back
                </button>
              )}
            </div>
          </div>
          <p style={ledeStyle}>
            {step.kind === 'add'
              ? 'Pick a source type. Warehouses connect instantly; we profile their schemas for modeling.'
              : step.kind === 'connect'
                ? 'Credentials stay server-side. We use them only to introspect & profile — read-only.'
                : 'Warehouses and sources cube-playground can model. Pick one to onboard its datasets.'}
          </p>

          <div style={{ marginTop: 20 }}>
            {step.kind === 'add' ? (
              <AddConnector onPick={(source) => setStep({ kind: 'connect', source })} />
            ) : step.kind === 'connect' ? (
              <ConnectorCredentials
                source={step.source}
                onProvisioned={async (connectorId) => {
                  // Refresh the workspace connector list, then open the new one.
                  const res = await onboardingClient.connectors();
                  setConnectors(res.connectors);
                  const c = res.connectors.find((x) => x.id === connectorId);
                  setStep(c ? { kind: 'detail', connector: c } : { kind: 'list' });
                }}
              />
            ) : loading ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading connectors…</div>
            ) : error ? (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--destructive-soft)',
                  color: 'var(--destructive-ink)',
                  fontSize: 12.5,
                }}
              >
                Could not load connectors: {error}
              </div>
            ) : connectors.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', marginTop: 48 }}>
                No connectors configured for this workspace yet.
              </div>
            ) : (
              <ConnectorsList
                connectors={connectors}
                onOpen={(id) => {
                  const c = connectors.find((x) => x.id === id);
                  if (c) setStep({ kind: 'detail', connector: c });
                }}
                onAdd={() => setStep({ kind: 'add' })}
              />
            )}
          </div>

          {/* Cross-source links are a workspace-level, advisory concept (not tied
              to one draft), so they live on the hub — declare + view them here. */}
          {step.kind === 'list' && !loading && !error ? (
            <div style={{ marginTop: 24 }}>
              <CrossSourceLinksPanel canWrite={canWrite} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
