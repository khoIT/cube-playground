/**
 * Collapsible "Concept tier" sub-section inside the glossary edit form.
 * Surfaces entity_cube, entity_pk, default_measure_ref, default_filter_json
 * (JSON textarea with parse validation), ranking_json (order + limit), and
 * trust_tier (select). All fields are optional — empty = null when submitted.
 *
 * Uses the same token-based styling as glossary-edit-form.tsx.
 */

import React, { useState } from 'react';
import styled from 'styled-components';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { GlossaryFilter, GlossaryRanking, GlossaryTrustTier } from '../../../api/glossary-client';

export interface ConceptTierValues {
  entityCube: string;
  entityPk: string;
  defaultMeasureRef: string;
  defaultFilterJson: string; // raw JSON string or empty
  rankingOrder: 'ASC' | 'DESC';
  rankingLimit: string; // kept as string in the form; parsed on submit
  trustTier: GlossaryTrustTier | '';
}

export interface ConceptTierResult {
  entityCube: string | null;
  entityPk: string | null;
  defaultMeasureRef: string | null;
  defaultFilter: GlossaryFilter | null;
  ranking: GlossaryRanking | null;
  trustTier: GlossaryTrustTier | null;
}

/** Parse raw form values into the wire shape. Returns null strings for empties. */
export function parseConceptTier(v: ConceptTierValues): ConceptTierResult & { filterError?: string } {
  const entityCube = v.entityCube.trim() || null;
  const entityPk = v.entityPk.trim() || null;
  const defaultMeasureRef = v.defaultMeasureRef.trim() || null;
  const trustTier = v.trustTier || null;

  let defaultFilter: GlossaryFilter | null = null;
  let filterError: string | undefined;
  const rawFilter = v.defaultFilterJson.trim();
  if (rawFilter) {
    try {
      const parsed = JSON.parse(rawFilter) as unknown;
      if (
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).member === 'string' &&
        typeof (parsed as Record<string, unknown>).op === 'string'
      ) {
        defaultFilter = parsed as GlossaryFilter;
      } else {
        filterError = 'Must be an object with {member, op, value}';
      }
    } catch {
      filterError = 'Invalid JSON';
    }
  }

  const hasRanking = entityCube || defaultMeasureRef;
  const limitNum = parseInt(v.rankingLimit, 10);
  const ranking: GlossaryRanking | null = hasRanking && !isNaN(limitNum) && limitNum > 0
    ? { order: v.rankingOrder, default_limit: limitNum }
    : null;

  return { entityCube, entityPk, defaultMeasureRef, defaultFilter, ranking, trustTier, filterError };
}

interface Props {
  values: ConceptTierValues;
  onChange: (patch: Partial<ConceptTierValues>) => void;
}

const Section = styled.div`
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm, 6px);
  overflow: hidden;
`;

const Toggle = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--bg-subtle, var(--bg-muted));
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-sans);
  color: var(--text-secondary);
  text-align: left;
  &:hover { background: var(--bg-muted); }
`;

const ConceptBadgeInline = styled.span`
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--info-soft, rgba(59,130,246,0.12));
  color: var(--info-ink);
  margin-left: 4px;
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--bg-app);
`;

const Row2 = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  font-family: var(--font-sans);
`;

const Input = styled.input`
  padding: 7px 10px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-input, var(--bg-app));
  color: var(--text-primary);
  font-size: 13px;
  font-family: var(--font-sans);
  &:focus { outline: none; border-color: var(--brand); }
`;

const Select = styled.select`
  padding: 7px 10px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-input, var(--bg-app));
  color: var(--text-primary);
  font-size: 13px;
  font-family: var(--font-sans);
  cursor: pointer;
  &:focus { outline: none; border-color: var(--brand); }
`;

const JsonArea = styled.textarea<{ $error?: boolean }>`
  padding: 7px 10px;
  border: 1px solid ${(p) => (p.$error ? 'var(--destructive-ink)' : 'var(--border-card)')};
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-input, var(--bg-app));
  color: var(--text-primary);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  min-height: 60px;
  resize: vertical;
  &:focus { outline: none; border-color: var(--brand); }
`;

const ErrorHint = styled.div`
  font-size: 11px;
  color: var(--destructive-ink);
  font-family: var(--font-sans);
  margin-top: 1px;
`;

const Hint = styled.div`
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-sans);
  line-height: 1.4;
`;

const RankingRow = styled.div`
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px;
`;

export function GlossaryConceptTierSection({ values, onChange }: Props) {
  const [open, setOpen] = useState(() =>
    !!(values.entityCube || values.entityPk || values.defaultMeasureRef || values.defaultFilterJson || values.rankingLimit || values.trustTier)
  );

  const [filterError, setFilterError] = useState<string | undefined>();

  function validateFilter(raw: string) {
    if (!raw.trim()) { setFilterError(undefined); return; }
    try {
      const p = JSON.parse(raw) as unknown;
      if (p && typeof p === 'object' && !Array.isArray(p) &&
        typeof (p as Record<string, unknown>).member === 'string') {
        setFilterError(undefined);
      } else {
        setFilterError('Must be {member, op, value}');
      }
    } catch {
      setFilterError('Invalid JSON');
    }
  }

  const hasConcept = !!(values.entityCube || values.entityPk || values.defaultMeasureRef);

  return (
    <Section>
      <Toggle type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        Concept tier
        {hasConcept && <ConceptBadgeInline>concept</ConceptBadgeInline>}
      </Toggle>

      {open && (
        <Body>
          <Hint>Optional. When set, the chat agent resolves phrases like "top spenders" directly without clarifying.</Hint>

          <Row2>
            <Field>
              Entity cube
              <Input
                type="text"
                value={values.entityCube}
                onChange={(e) => onChange({ entityCube: e.target.value.slice(0, 64) })}
                placeholder="e.g. players"
              />
            </Field>
            <Field>
              Entity PK
              <Input
                type="text"
                value={values.entityPk}
                onChange={(e) => onChange({ entityPk: e.target.value.slice(0, 128) })}
                placeholder="e.g. players.user_id"
              />
            </Field>
          </Row2>

          <Field>
            Default measure ref
            <Input
              type="text"
              value={values.defaultMeasureRef}
              onChange={(e) => onChange({ defaultMeasureRef: e.target.value.slice(0, 128) })}
              placeholder="e.g. recharge.revenue_vnd"
            />
          </Field>

          <Field>
            Default filter (JSON)
            <JsonArea
              value={values.defaultFilterJson}
              $error={!!filterError}
              onChange={(e) => {
                onChange({ defaultFilterJson: e.target.value });
                validateFilter(e.target.value);
              }}
              placeholder={'{"member":"recharge.revenue_vnd","op":">","value":0}'}
              rows={2}
            />
            {filterError ? <ErrorHint>{filterError}</ErrorHint> : null}
          </Field>

          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', marginBottom: 4 }}>
              Ranking
            </div>
            <RankingRow>
              <Field as="div">
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', marginBottom: 3 }}>Order</div>
                <Select
                  value={values.rankingOrder}
                  onChange={(e) => onChange({ rankingOrder: e.target.value as 'ASC' | 'DESC' })}
                >
                  <option value="DESC">DESC (highest first)</option>
                  <option value="ASC">ASC (lowest first)</option>
                </Select>
              </Field>
              <Field>
                Default limit
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={values.rankingLimit}
                  onChange={(e) => onChange({ rankingLimit: e.target.value })}
                  placeholder="10"
                />
              </Field>
            </RankingRow>
            <Hint>Leave limit empty to omit ranking config entirely.</Hint>
          </div>

          <Field>
            Trust tier
            <Select
              value={values.trustTier}
              onChange={(e) => onChange({ trustTier: e.target.value as GlossaryTrustTier | '' })}
            >
              <option value="">— none —</option>
              <option value="certified">Certified</option>
              <option value="experimental">Experimental</option>
            </Select>
          </Field>
        </Body>
      )}
    </Section>
  );
}
