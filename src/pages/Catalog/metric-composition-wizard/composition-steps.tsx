/**
 * Composition wizard step bodies. Each step is a pure controlled component
 * that reads from `draft` and calls `setField`. The step nav + validation
 * live in `composition-wizard-page.tsx`.
 */

import styled from 'styled-components';

import type { Concept } from '../data-model-tab/concept-types';
import {
  DOMAINS,
  TRUST_TIERS,
} from '../metrics-tab/business-metric-constants';
import type {
  CompositionDraft,
  FormulaKind,
} from './composition-draft-types';
import { deriveIdFromLabel } from './composition-draft-types';

void TRUST_TIERS; // re-exported for future expansion

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const RadioRow = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
`;

const RadioCard = styled.label<{ $active: boolean }>`
  flex: 1 1 220px;
  padding: 14px 16px;
  border: 1px solid
    ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: 8px;
  cursor: pointer;
  background: ${(p) =>
    p.$active ? 'rgba(240, 90, 34, 0.06)' : 'var(--bg-card)'};

  h4 {
    margin: 0 0 4px;
    font-size: 14px;
    color: var(--text-primary);
  }
  p {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
  }
  input { display: none; }
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
`;

const Input = styled.input`
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border-card);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg-card);
  color: var(--text-primary);

  &:focus {
    outline: none;
    border-color: var(--brand);
  }
`;

const Textarea = styled.textarea`
  min-height: 80px;
  padding: 8px 12px;
  border: 1px solid var(--border-card);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: inherit;
  resize: vertical;
`;

const Select = styled.select`
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border-card);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg-card);
  color: var(--text-primary);
`;

const PickerList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--border-card);
  border-radius: 8px;
`;

const PickerRow = styled.li<{ $active: boolean }>`
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-card);
  background: ${(p) => (p.$active ? 'rgba(240,90,34,0.08)' : 'transparent')};
  cursor: pointer;
  font-size: 12px;
  font-family: var(--font-mono, monospace);

  &:last-child { border-bottom: 0; }
  &:hover { background: rgba(240,90,34,0.06); }
`;

const Errors = styled.ul`
  color: var(--danger);
  font-size: 12px;
  padding-left: 18px;
  margin: 4px 0 0;
`;

interface StepProps {
  draft: CompositionDraft;
  setField: <K extends keyof CompositionDraft>(
    key: K,
    value: CompositionDraft[K],
  ) => void;
  errors: string[];
}

export function StepType({ draft, setField, errors }: StepProps) {
  const opts: Array<{ kind: FormulaKind; title: string; body: string }> = [
    {
      kind: 'measure',
      title: 'Passthrough measure',
      body: 'Wrap a single Cube measure (e.g. recharge.revenue_vnd) with curated metadata.',
    },
    {
      kind: 'ratio',
      title: 'Ratio',
      body: 'Two Cube measures with the same time grain. Numerator / denominator.',
    },
  ];
  return (
    <Section>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Formula type</h2>
      <RadioRow>
        {opts.map((o) => (
          <RadioCard key={o.kind} $active={draft.formulaKind === o.kind}>
            <input
              type="radio"
              name="formulaKind"
              checked={draft.formulaKind === o.kind}
              onChange={() => setField('formulaKind', o.kind)}
            />
            <h4>{o.title}</h4>
            <p>{o.body}</p>
          </RadioCard>
        ))}
      </RadioRow>
      {errors.length > 0 && <Errors>{errors.map((e) => <li key={e}>{e}</li>)}</Errors>}
    </Section>
  );
}

interface MeasurePickerProps {
  concepts: Concept[];
  value: string;
  onChange: (v: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
}

function MeasurePicker({
  concepts,
  value,
  onChange,
  query,
  onQueryChange,
}: MeasurePickerProps) {
  const measures = concepts.filter((c) => c.type === 'measure');
  const q = query.trim().toLowerCase();
  const filtered = q
    ? measures.filter(
        (c) =>
          c.fqn.toLowerCase().includes(q) ||
          (c.description?.toLowerCase().includes(q) ?? false),
      )
    : measures;
  return (
    <>
      <Input
        placeholder="Filter measures…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <PickerList>
        {filtered.slice(0, 50).map((c) => (
          <PickerRow
            key={c.fqn}
            $active={c.fqn === value}
            onClick={() => onChange(c.fqn)}
          >
            {c.fqn}
            {c.description && (
              <div style={{ color: '#737373', marginTop: 2, fontSize: 11 }}>
                {c.description}
              </div>
            )}
          </PickerRow>
        ))}
        {filtered.length === 0 && (
          <PickerRow $active={false}>No matches.</PickerRow>
        )}
      </PickerList>
    </>
  );
}

interface MeasureStepProps extends StepProps {
  concepts: Concept[];
  query: string;
  onQueryChange: (q: string) => void;
}

export function StepNumerator({
  draft,
  setField,
  errors,
  concepts,
  query,
  onQueryChange,
}: MeasureStepProps) {
  const isRatio = draft.formulaKind === 'ratio';
  const key = isRatio ? 'ratioNumerator' : 'measureRef';
  const value = isRatio ? draft.ratioNumerator : draft.measureRef;
  return (
    <Section>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
        {isRatio ? 'Numerator measure' : 'Source measure'}
      </h2>
      <MeasurePicker
        concepts={concepts}
        value={value}
        onChange={(v) => setField(key, v)}
        query={query}
        onQueryChange={onQueryChange}
      />
      {errors.length > 0 && <Errors>{errors.map((e) => <li key={e}>{e}</li>)}</Errors>}
    </Section>
  );
}

export function StepDenominator({
  draft,
  setField,
  errors,
  concepts,
  query,
  onQueryChange,
}: MeasureStepProps) {
  return (
    <Section>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Denominator measure</h2>
      <MeasurePicker
        concepts={concepts}
        value={draft.ratioDenominator}
        onChange={(v) => setField('ratioDenominator', v)}
        query={query}
        onQueryChange={onQueryChange}
      />
      {errors.length > 0 && <Errors>{errors.map((e) => <li key={e}>{e}</li>)}</Errors>}
    </Section>
  );
}

export function StepMetadata({ draft, setField, errors }: StepProps) {
  const onLabelChange = (v: string) => {
    setField('label', v);
    if (!draft.id || draft.id === deriveIdFromLabel(draft.label)) {
      setField('id', deriveIdFromLabel(v));
    }
  };
  return (
    <Section>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Metadata</h2>
      <Field>
        Label
        <Input value={draft.label} onChange={(e) => onLabelChange(e.target.value)} />
      </Field>
      <Field>
        ID (kebab-snake, used as YAML filename)
        <Input value={draft.id} onChange={(e) => setField('id', e.target.value)} />
      </Field>
      <Field>
        Description
        <Textarea
          value={draft.description}
          onChange={(e) => setField('description', e.target.value)}
        />
      </Field>
      <Field>
        Owner (e.g. data-platform@vng)
        <Input value={draft.owner} onChange={(e) => setField('owner', e.target.value)} />
      </Field>
      <Field>
        Domain
        <Select
          value={draft.domain}
          onChange={(e) => setField('domain', e.target.value as CompositionDraft['domain'])}
        >
          {DOMAINS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </Select>
      </Field>
      <Field>
        Tier (1 = leadership KPI · 6 = experimental)
        <Select
          value={String(draft.tier)}
          onChange={(e) =>
            setField('tier', Number(e.target.value) as CompositionDraft['tier'])
          }
        >
          {[1, 2, 3, 4, 5, 6].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
      </Field>
      {errors.length > 0 && <Errors>{errors.map((e) => <li key={e}>{e}</li>)}</Errors>}
    </Section>
  );
}
