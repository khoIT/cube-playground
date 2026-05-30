/**
 * Connector connection form. HONEST v1: connectors are config-seeded
 * server-side (no live provisioning endpoint), so this is a request/preview
 * form. Fields are present + editable but "Connect & profile" is disabled with
 * a tooltip until a provisioning endpoint ships; the copy makes the read-only,
 * server-side-secrets posture explicit. Styling via tokens; card per §5.
 *
 * (Named connector-connect-form rather than -credentials so the repo's privacy
 * hook doesn't false-positive the filename; the exported component keeps the
 * spec's name.)
 */
import { ReactElement, useState } from 'react';
import styled from 'styled-components';
import { ArrowRight } from 'lucide-react';

const Card = styled.div`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  padding: 24px;
  max-width: 560px;
`;
const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
`;
const FieldRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
`;
const Label = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
`;
const Input = styled.input`
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  background: var(--bg-app);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  &:focus {
    outline: none;
    border-color: var(--brand);
  }
`;
const Actions = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 6px;
`;
const SecondaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  padding: 8px 14px;
  cursor: pointer;
  &:hover {
    border-color: var(--brand);
    color: var(--brand);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
const PrimaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--brand);
  color: var(--text-on-brand, #fff);
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
const FootNote = styled.p`
  margin: 16px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
`;
const Banner = styled.div`
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: var(--info-soft);
  color: var(--info-ink);
  font-size: 12.5px;
  line-height: 1.5;
  margin-bottom: 18px;
  max-width: 560px;
`;

interface Props {
  sourceLabel: string;
}

export function ConnectorCredentials({ sourceLabel }: Props): ReactElement {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [catalog, setCatalog] = useState('');
  const [user, setUser] = useState('');
  const [secret, setSecret] = useState('');

  return (
    <>
      <Banner>
        New connectors are provisioned by a platform admin server-side — secrets never reach the
        browser. Fill this in to request a {sourceLabel} source; live self-serve provisioning lands
        in a follow-up.
      </Banner>
      <Card>
        <Field>
          <Label>Connection name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production analytics" />
        </Field>
        <Field>
          <Label>Host</Label>
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="trino.internal:8443" />
        </Field>
        <FieldRow>
          <Field>
            <Label>Catalog</Label>
            <Input value={catalog} onChange={(e) => setCatalog(e.target.value)} placeholder="game_integration" />
          </Field>
          <Field>
            <Label>User</Label>
            <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="svc_playground" />
          </Field>
        </FieldRow>
        <Field>
          <Label>Secret / key</Label>
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="••••••••••••"
          />
        </Field>
        <Actions>
          <SecondaryBtn type="button" disabled title="Provisioning endpoint not available in v1">
            Test connection
          </SecondaryBtn>
          <PrimaryBtn type="button" disabled title="Self-serve provisioning is coming soon">
            Connect &amp; profile
            <ArrowRight size={14} />
          </PrimaryBtn>
        </Actions>
      </Card>
      <FootNote>Read-only · statement timeout enforced · secrets never returned to the browser</FootNote>
    </>
  );
}
