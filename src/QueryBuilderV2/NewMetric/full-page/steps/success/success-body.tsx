import styled from 'styled-components';
import { useLocation, useHistory } from 'react-router-dom';
import { CheckCircle, ExternalLink, Plus } from 'lucide-react';
import { useNewMetricDraft } from '../../../hooks/use-new-metric-draft';

const Page = styled.div`
  min-height: 100vh;
  background: var(--bg-app);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans);
`;

const Card = styled.div`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 16px;
  padding: 40px;
  max-width: 520px;
  width: 100%;
  text-align: center;
  box-shadow: var(--shadow-sm);
`;

const IconCircle = styled.div`
  width: 80px;
  height: 80px;
  background: rgba(0, 150, 136, 0.12);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
`;

const Heading = styled.h1`
  font-family: 'Geist', sans-serif;
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 8px;
`;

const Sub = styled.div`
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 24px;
`;

const Mono = styled.code`
  font-family: var(--font-mono);
  font-size: 13px;
  background: var(--bg-muted);
  padding: 2px 6px;
  border-radius: 4px;
`;

const Buttons = styled.div`
  display: flex;
  gap: 12px;
  justify-content: center;
`;

const Btn = styled.button<{ $primary?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  background: ${(p) => (p.$primary ? 'var(--brand)' : 'var(--bg-card)')};
  color: ${(p) => (p.$primary ? 'white' : 'var(--text-primary)')};
  border: 1px solid ${(p) => (p.$primary ? 'var(--brand)' : 'var(--border-card)')};
  &:hover {
    background: ${(p) => (p.$primary ? 'var(--brand-hover)' : 'var(--bg-muted)')};
  }
`;

/**
 * Success page rendered at /metrics/new/success?name=...&cubeName=...
 * RR5: uses useHistory + useLocation only (no useNavigate / useSearchParams).
 * Falls back to URL query when history.state is missing (hard reload).
 */
export function NewMetricSuccess() {
  const location = useLocation();
  const history = useHistory();
  const state = location.state as { name?: string; cubeName?: string } | undefined;
  const params = new URLSearchParams(location.search);
  const name = state?.name ?? params.get('name') ?? '—';
  const cubeName = state?.cubeName ?? params.get('cubeName') ?? '—';

  const draftState = useNewMetricDraft();

  function viewInPlayground() {
    history.push(`/build?cube=${encodeURIComponent(cubeName)}`);
  }
  function startAnother() {
    draftState.clearPersisted();
    draftState.reset();
    history.push('/data-model/new?v=2');
  }

  return (
    <Page>
      <Card>
        <IconCircle>
          <CheckCircle size={48} color="var(--success)" />
        </IconCircle>
        <Heading>Data model updated</Heading>
        <Sub>
          <Mono>{name}</Mono> added to <Mono>{cubeName}</Mono>.
        </Sub>
        <Buttons>
          <Btn onClick={viewInPlayground}>
            <ExternalLink size={14} /> View in Playground
          </Btn>
          <Btn $primary onClick={startAnother}>
            <Plus size={14} /> Start another metric
          </Btn>
        </Buttons>
      </Card>
    </Page>
  );
}
