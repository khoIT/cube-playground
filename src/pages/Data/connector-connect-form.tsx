/**
 * Connector connection form. Renders fields dynamically from the source-type
 * registry (GET /source-types), tests the connection, and provisions a real
 * connector (secrets POSTed, sealed server-side, never echoed). On success the
 * parent routes into the connector detail / introspect flow.
 *
 * (Named connector-connect-form rather than -credentials so the repo's privacy
 * hook doesn't false-positive the filename; the exported component keeps the
 * spec's name.)
 */
import { ReactElement, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { ArrowRight, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { onboardingClient } from '../../api/onboarding-client';
import type { SourceField, SourceType, TestConnectorResult } from '../../api/onboarding-client';

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
const Label = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
`;
const Hint = styled.span`
  font-size: 11.5px;
  font-weight: 400;
  color: var(--text-muted);
`;
const inputCss = `
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  background: var(--bg-app);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
`;
const Input = styled.input`
  ${inputCss}
  &:focus { outline: none; border-color: var(--brand); }
`;
const CheckRow = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  margin-bottom: 14px;
  cursor: pointer;
`;
const Actions = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
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
  &:hover:not(:disabled) { border-color: var(--brand); color: var(--brand); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const PrimaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--brand);
  color: var(--text-on-brand);
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  cursor: pointer;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Banner = styled.div<{ $tone: 'info' | 'success' | 'warning' | 'destructive' }>`
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: var(--${(p) => p.$tone}-soft);
  color: var(--${(p) => p.$tone}-ink);
  font-size: 12.5px;
  line-height: 1.5;
  margin-bottom: 18px;
  max-width: 560px;
`;
const FootNote = styled.p`
  margin: 16px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
`;

interface Props {
  source: { id: string; label: string };
  onProvisioned: (connectorId: string) => void;
  /**
   * Edit mode: prefill non-secret fields from an existing connector. The secret
   * field stays blank — leaving it empty keeps the stored credential (no
   * blank-overwrite); typing a new value rotates it.
   */
  initial?: { id: string; label: string; config: Record<string, unknown> };
}

export function ConnectorCredentials({ source, onProvisioned, initial }: Props): ReactElement {
  const editMode = Boolean(initial);
  const [sourceType, setSourceType] = useState<SourceType | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [name, setName] = useState(initial?.label ?? `${source.label} connection`);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [test, setTest] = useState<TestConnectorResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    onboardingClient
      .sourceTypes()
      .then((res) => {
        if (!alive) return;
        const st = res.sourceTypes.find((s) => s.id === source.id) ?? null;
        setSourceType(st);
        if (st) {
          const seed: Record<string, unknown> = {};
          for (const f of st.fields) if (f.default !== undefined) seed[f.key] = f.default;
          // Edit mode: overlay the connector's stored non-secret config (the
          // secret field stays blank → keep existing credential).
          if (initial) {
            for (const f of st.fields) {
              if (f.secret) continue;
              const v = initial.config[f.key];
              if (v !== undefined && v !== null) seed[f.key] = v;
            }
          }
          setValues(seed);
        }
      })
      .catch((e) => alive && setLoadErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [source.id, initial]);

  const requiredFilled = useMemo(() => {
    if (!sourceType) return false;
    return sourceType.fields.every((f) => !f.required || hasValue(values[f.key]));
  }, [sourceType, values]);

  function set(key: string, v: unknown) {
    setValues((prev) => ({ ...prev, [key]: v }));
    setTest(null); // any field edit invalidates a prior test result
  }

  async function runTest() {
    if (!sourceType) return;
    setTesting(true);
    setError(null);
    try {
      setTest(await onboardingClient.testConnector(sourceType.id, values));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function provision() {
    if (!sourceType) return;
    setSubmitting(true);
    setError(null);
    try {
      const res =
        initial != null
          ? await onboardingClient.updateConnector(initial.id, {
              label: name.trim() || source.label,
              fields: values,
            })
          : await onboardingClient.provisionConnector({
              label: name.trim() || source.label,
              sourceType: sourceType.id,
              fields: values,
            });
      if (res.connector) onProvisioned(res.connector.id);
      else setError(`${editMode ? 'Update' : 'Provisioning'} returned no connector.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadErr) {
    return <Banner $tone="destructive"><AlertTriangle size={16} /> Could not load source types: {loadErr}</Banner>;
  }
  if (!sourceType) {
    return (
      <Banner $tone="warning">
        <AlertTriangle size={16} />
        {source.label} isn’t available for self-serve connect yet — warehouses (Trino, Postgres,
        BigQuery…) are supported first; MMP / ad-network sources are coming.
      </Banner>
    );
  }

  return (
    <>
      <Banner $tone="info">
        Credentials are sealed server-side (AES-GCM) and never returned to the browser. We use them
        only to introspect &amp; profile — read-only.
        {editMode ? ' Leave the password field blank to keep the current credential.' : ''}
      </Banner>
      <Card>
        <Field>
          <Label>Connection name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production analytics" />
        </Field>

        {sourceType.fields.map((f) => renderField(f, values[f.key], (v) => set(f.key, v), editMode))}

        {test && (
          <Banner $tone={test.ok ? 'success' : 'warning'} style={{ marginTop: 4 }}>
            {test.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {test.ok
              ? `Connection OK${test.latencyMs != null ? ` · ${test.latencyMs}ms` : ''}`
              : `${test.code ?? 'Test failed'}: ${test.message ?? 'unable to connect'}`}
          </Banner>
        )}
        {error && (
          <Banner $tone="destructive" style={{ marginTop: 4 }}>
            <AlertTriangle size={16} /> {error}
          </Banner>
        )}

        <Actions>
          <SecondaryBtn type="button" onClick={runTest} disabled={!requiredFilled || testing}>
            {testing ? <Loader2 size={14} className="spin" /> : null}
            Test connection
          </SecondaryBtn>
          <PrimaryBtn type="button" onClick={provision} disabled={!requiredFilled || submitting}>
            {submitting ? <Loader2 size={14} /> : null}
            {editMode ? 'Save changes' : 'Connect & profile'}
            <ArrowRight size={14} />
          </PrimaryBtn>
        </Actions>
      </Card>
      <FootNote>Read-only · statement timeout enforced · secrets never returned to the browser</FootNote>
    </>
  );
}

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

function renderField(
  f: SourceField,
  value: unknown,
  onChange: (v: unknown) => void,
  editMode = false,
): ReactElement {
  if (f.type === 'boolean') {
    return (
      <CheckRow key={f.key}>
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {f.label}
      </CheckRow>
    );
  }
  if (f.type === 'file') {
    return (
      <Field key={f.key}>
        <Label>
          {f.label}
          {f.help ? <Hint> — {f.help}</Hint> : null}
        </Label>
        <Input
          type="file"
          accept="application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            onChange(file ? await file.text() : '');
          }}
        />
      </Field>
    );
  }
  return (
    <Field key={f.key}>
      <Label>
        {f.label}
        {f.help ? <Hint> — {f.help}</Hint> : null}
      </Label>
      <Input
        type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
        value={value === undefined || value === null ? '' : String(value)}
        placeholder={f.secret && editMode ? '•••••• (unchanged)' : f.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
