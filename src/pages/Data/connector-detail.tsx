/**
 * Connector detail: header (badge + label, back/refresh) and a tab bar —
 * Datasets · Agents · Coverage · Drift · History. Coverage and Drift DEEP-LINK
 * out to the shipped /drift-center (+ coverage) pages scoped to the active game
 * (v1 decision: deep-link, not embed). The Datasets tab hosts the
 * introspect → table-pick → triage sub-flow. Tab bar mirrors DriftCenter's.
 */
import { ReactElement, useEffect, useState } from 'react';
import styled from 'styled-components';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useHistory } from 'react-router-dom';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useAuthUser } from '../../auth/auth-context';
import { onboardingClient } from '../../api/onboarding-client';
import type { Connector, TableMeta, DraftModelRow } from '../../api/onboarding-client';
import { DatasetTables, type OnboardMode } from './dataset-tables';
import { TriageCanvas } from './triage/triage-canvas';

type Tab = 'datasets' | 'agents' | 'coverage' | 'drift' | 'history';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'datasets', label: 'Datasets' },
  { id: 'agents', label: 'Agents' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'drift', label: 'Drift' },
  { id: 'history', label: 'History' },
];

const Head = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 4px;
`;
const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 13px;
  font-weight: 700;
`;
const TitleBlock = styled.div`
  flex: 1;
`;
const Title = styled.h1`
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
`;
const Meta = styled.div`
  font-size: 12.5px;
  color: var(--text-muted);
  margin-top: 2px;
`;
const Ghost = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  &:hover {
    border-color: var(--brand);
    color: var(--brand);
  }
`;
const Tabs = styled.div`
  display: flex;
  gap: 4px;
  margin: 18px 0 16px;
  border-bottom: 1px solid var(--border-card);
`;
const TabBtn = styled.button<{ $active: boolean }>`
  appearance: none;
  border: none;
  background: none;
  padding: 8px 14px;
  margin-bottom: -1px;
  border-bottom: 2px solid ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-primary)' : 'var(--text-muted)')};
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  cursor: pointer;
  &:hover {
    color: var(--text-primary);
  }
`;
const Empty = styled.div`
  padding: 32px 0;
  font-size: 13px;
  color: var(--text-muted);
`;

function initials(label: string): string {
  const w = label.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/)[0] ?? label;
  return (w.slice(0, 2) || '?').replace(/^./, (c) => c.toUpperCase());
}

interface Props {
  connector: Connector;
  onBack: () => void;
}

export function ConnectorDetail({ connector, onBack }: Props): ReactElement {
  const gameId = useActiveGameId();
  const history = useHistory();
  const user = useAuthUser();
  const canWrite = user ? user.role !== 'viewer' : true;

  const [tab, setTab] = useState<Tab>('datasets');
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<OnboardMode>('cold');
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<DraftModelRow | null>(null);

  // Deep-link Coverage / Drift out to the shipped pages, scoped to the game.
  useEffect(() => {
    if (tab === 'drift') history.push(`/drift-center?game=${encodeURIComponent(gameId)}`);
    if (tab === 'coverage') history.push(`/settings?game=${encodeURIComponent(gameId)}#coverage`);
  }, [tab, gameId, history]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    onboardingClient
      .introspect({ connectorId: connector.id, game: gameId })
      .then((res) => {
        if (!cancelled) {
          setTables(res.tables);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connector.id, gameId]);

  async function handleGenerate(selected: string[], pickedMode: OnboardMode) {
    setGenerating(true);
    setError(null);
    try {
      const res = await onboardingClient.generate({
        connectorId: connector.id,
        game: gameId,
        tables: selected,
        mode: pickedMode === 'warm' ? 'warm' : 'cold',
      });
      if (res.drafts.length > 0) setDraft(res.drafts[0]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  // Once a draft exists, the connector detail becomes the triage canvas.
  if (draft) return <TriageCanvas draftId={draft.id} />;

  return (
    <>
      <Head>
        <Badge aria-hidden>{initials(connector.label)}</Badge>
        <TitleBlock>
          <Title>{connector.label}</Title>
          <Meta>
            {connector.catalog} catalog · {tables.length} tables
          </Meta>
        </TitleBlock>
        <Ghost type="button" onClick={onBack}>
          <ArrowLeft size={14} /> Connectors
        </Ghost>
        <Ghost type="button" onClick={() => window.location.reload()}>
          <RefreshCw size={14} /> Refresh
        </Ghost>
      </Head>

      <Tabs role="tablist">
        {TABS.map((t) => (
          <TabBtn
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            $active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </TabBtn>
        ))}
      </Tabs>

      {error ? (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--destructive-soft)',
            color: 'var(--destructive-ink)',
            fontSize: 12.5,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      ) : null}

      {tab === 'datasets' ? (
        loading ? (
          <Empty>Profiling tables…</Empty>
        ) : tables.length === 0 ? (
          <Empty>No tables found for this connector + game.</Empty>
        ) : (
          <DatasetTables
            tables={tables}
            mode={mode}
            onModeChange={setMode}
            canWrite={canWrite}
            generating={generating}
            warmSource={connector.catalog}
            onGenerate={handleGenerate}
          />
        )
      ) : tab === 'agents' ? (
        <Empty>Onboarding &amp; chat agents scoped to this connector land in a follow-up.</Empty>
      ) : tab === 'history' ? (
        <Empty>Draft &amp; approval audit history for this connector lands in a follow-up.</Empty>
      ) : (
        <Empty>Opening {tab}…</Empty>
      )}
    </>
  );
}
