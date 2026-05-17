import styled from 'styled-components';
import type { ArtifactKind, Format, Grain, Visibility, NewMetricDraftV2, NewMetricDraftV3 } from '../../../types';
import { TagCombo } from '../../../components/tag-combo';
import { KindBadge } from '../../../components/kind-badge';
import { computeAutoMetricName, computeAutoMetricTitle } from '../../hooks/compute-auto-metric-name';

const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;

const FORMATS: Array<{ id: Format; label: string; preview: string }> = [
  { id: 'number', label: 'Number', preview: '1,234,567' },
  { id: 'currency-vnd', label: 'Currency · VND', preview: '₫ 8.42B' },
  { id: 'currency-usd', label: 'Currency · USD', preview: '$ 8.42M' },
  { id: 'percent', label: 'Percent', preview: '12.4%' },
  { id: 'duration', label: 'Duration', preview: '12m 24s' },
];

const GRAINS: Grain[] = ['hourly', 'daily', 'weekly', 'monthly'];
const VISIBILITIES: Array<{ id: Visibility; label: string }> = [
  { id: 'team', label: 'Team · Live-ops' },
  { id: 'org', label: 'Whole org' },
  { id: 'private', label: 'Just me' },
];

const Grid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
`;
const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
  color: var(--text-secondary);
`;
const Input = styled.input`
  height: 36px;
  padding: 0 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 8px;
  font-size: 13.5px;
  &:focus { border-color: var(--brand); outline: none; }
  &.mono { font-family: var(--font-mono); }
`;
const Textarea = styled.textarea`
  padding: 8px 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 8px;
  font-size: 13px;
  min-height: 80px;
  resize: vertical;
  &:focus { border-color: var(--brand); outline: none; }
`;
const Select = styled.select`
  height: 36px;
  padding: 0 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 8px;
  font-size: 13.5px;
`;
const Seg = styled.div`
  display: inline-flex;
  background: var(--bg-muted);
  border-radius: 8px;
  padding: 2px;
`;
const SegBtn = styled.button<{ $active: boolean }>`
  padding: 6px 12px;
  font-size: 12.5px;
  border-radius: 6px;
  background: ${(p) => (p.$active ? 'var(--bg-card)' : 'transparent')};
  border: 1px solid ${(p) => (p.$active ? 'var(--border-card)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-primary)' : 'var(--text-secondary)')};
  cursor: pointer;
`;
const Pill = styled.span<{ $ok: boolean }>`
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 10.5px;
  font-weight: 600;
  border-radius: 4px;
  background: ${(p) => (p.$ok ? 'var(--success)' : 'var(--warning)')};
  color: white;
`;
const Preview = styled.div`
  font-size: 12.5px;
  color: var(--text-muted);
  margin-top: 4px;
`;

export type IdentityBodyProps = {
  draft: NewMetricDraftV2;
  onField: <K extends keyof NewMetricDraftV2>(field: K, value: NewMetricDraftV2[K]) => void;
  tagSuggestions: string[];
};

export function IdentityBody({ draft, onField, tagSuggestions }: IdentityBodyProps) {
  const allTags = tagSuggestions;
  const nameOk = SNAKE_CASE_RE.test(draft.name);
  const fmt = FORMATS.find((f) => f.id === draft.format) ?? FORMATS[0];
  // `draft` is typed V2 for back-compat but populated by NewMetricPage from V3.
  // Read the discriminator defensively so the chip just hides for legacy callers.
  const kind: ArtifactKind | undefined = (draft as NewMetricDraftV3).artifactKind;

  function autoName() {
    const name = computeAutoMetricName(draft);
    const title = computeAutoMetricTitle(draft);
    if (name && name !== 'untitled_metric') onField('name', name);
    if (title) onField('title', title);
  }

  return (
    <>
      <Grid>
        <Field>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Name
            {kind && <KindBadge kind={kind} compact />}
          </span>
          {draft.name && <Pill $ok={nameOk}>{nameOk ? 'valid' : 'invalid'}</Pill>}
          <Input
            className="mono"
            value={draft.name}
            onChange={(e) => onField('name', e.target.value)}
            placeholder="my_metric_name"
          />
        </Field>
        <Field>
          Title <span style={{ color: 'var(--danger)' }}>*</span>
          <Input
            value={draft.title}
            onChange={(e) => onField('title', e.target.value)}
            placeholder="Total Revenue"
          />
        </Field>
      </Grid>
      <Field style={{ marginTop: 16 }}>
        Description
        <Textarea
          value={draft.description}
          onChange={(e) => onField('description', e.target.value)}
          placeholder="What this metric measures, units, caveats…"
        />
      </Field>
      <Grid style={{ marginTop: 16 }}>
        <Field>
          Format
          <Select value={draft.format} onChange={(e) => onField('format', e.target.value as Format)}>
            {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select>
          <Preview>Preview: {fmt.preview}</Preview>
        </Field>
        <Field>
          Time grain
          <Seg>
            {GRAINS.map((g) => (
              <SegBtn key={g} $active={draft.grain === g} onClick={() => onField('grain', g)} type="button">
                {capitalize(g)}
              </SegBtn>
            ))}
          </Seg>
        </Field>
      </Grid>
      <Grid style={{ marginTop: 16 }}>
        <Field>
          Visibility
          <Select value={draft.visibility} onChange={(e) => onField('visibility', e.target.value as Visibility)}>
            {VISIBILITIES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </Field>
        <Field>
          Tags
          <TagCombo
            value={draft.tags}
            onChange={(next) => onField('tags', next)}
            suggestions={allTags}
            placeholder="Type a tag and press Enter…"
          />
        </Field>
      </Grid>
      <div style={{ marginTop: 16 }}>
        <button
          onClick={autoName}
          type="button"
          style={{
            background: 'var(--brand-soft)',
            color: 'var(--brand)',
            border: '1px solid var(--brand)',
            borderRadius: 8,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: 12.5,
          }}
        >Auto-name from inputs</button>
      </div>
    </>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
