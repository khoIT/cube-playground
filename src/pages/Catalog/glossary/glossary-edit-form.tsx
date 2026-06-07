/**
 * Controlled form for create/edit modes. Mirrors the zod constraints on the
 * server: label <=80, description <=500, alias chips <=20 each, also the
 * Vietnamese fields. The editor_name prefills from a localStorage hint so
 * repeat authors don't retype it.
 */

import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import type { GlossaryStatus, GlossaryTerm } from '../../../api/glossary-client';
import { GlossaryAliasChips } from './glossary-alias-chips';
import { GlossaryStatusToggle } from './glossary-status-toggle';
import {
  GlossaryConceptTierSection,
  type ConceptTierValues,
} from './glossary-concept-tier-section';
import { getPref, setPref } from '../../../hooks/server-prefs-store';

const EDITOR_KEY = 'compass:prefs:glossary:editor-name';

export interface FormValues {
  label: string;
  description: string;
  labelVi: string;
  descriptionVi: string;
  primaryCatalogId: string;
  category: string;
  aliases: string[];
  aliasesVi: string[];
  editorName: string;
  status: GlossaryStatus;
  concept: ConceptTierValues;
}

interface Props {
  initial?: GlossaryTerm;
  onSubmit: (values: FormValues) => void;
  saving?: boolean;
  i18n: {
    label: string;
    labelVi: string;
    description: string;
    descriptionVi: string;
    primaryCatalogId: string;
    category: string;
    aliases: string;
    aliasesVi: string;
    editorName: string;
    statusDraft: string;
    statusOfficial: string;
    aliasPlaceholder: string;
    aliasPlaceholderVi: string;
    viPlaceholder: string;
    save: string;
  };
}

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
  /* Scroll the form body between the fixed header/footer. flex:1 + min-height:0
     are required for overflow-y to constrain inside the max-height:92vh dialog;
     without them the form grows to content and the lower fields (concept tier)
     get clipped with no scrollbar. */
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* Children must NOT shrink: in a column flexbox the items compress to fit
     before the container overflows, so overflow-y never engages. The concept
     tier <Section> (overflow:hidden → auto min-size 0) absorbs all the
     deficit and its fields get clipped with no scrollbar. */
  & > * { flex-shrink: 0; }
`;

const Row = styled.div<{ $cols?: number }>`
  display: grid;
  grid-template-columns: repeat(${(p) => p.$cols ?? 2}, 1fr);
  gap: 12px;
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  font-family: var(--font-sans);
`;

const Input = styled.input`
  padding: 8px 10px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-input, var(--bg-app));
  color: var(--text-primary);
  font-size: 13px;
  font-family: var(--font-sans);
  &:focus { outline: none; border-color: var(--brand); }
`;

const TextArea = styled.textarea`
  padding: 8px 10px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-input, var(--bg-app));
  color: var(--text-primary);
  font-size: 13px;
  font-family: var(--font-sans);
  min-height: 60px;
  resize: vertical;
  &:focus { outline: none; border-color: var(--brand); }
`;

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

function toForm(initial?: GlossaryTerm): FormValues {
  const ranking = initial?.ranking;
  return {
    label: initial?.label ?? '',
    description: initial?.description ?? '',
    labelVi: initial?.labelVi ?? '',
    descriptionVi: initial?.descriptionVi ?? '',
    primaryCatalogId: initial?.primaryCatalogId ?? '',
    category: initial?.category ?? '',
    aliases: initial?.aliases ?? [],
    aliasesVi: initial?.aliasesVi ?? [],
    editorName:
      initial?.editorName ??
      (typeof window !== 'undefined' ? getPref(EDITOR_KEY) ?? '' : ''),
    status: initial?.status ?? 'draft',
    concept: {
      entityCube: initial?.entityCube ?? '',
      entityPk: initial?.entityPk ?? '',
      defaultMeasureRef: initial?.defaultMeasureRef ?? '',
      defaultFilterJson: initial?.defaultFilter
        ? JSON.stringify(initial.defaultFilter)
        : '',
      rankingOrder: ranking?.order ?? 'DESC',
      rankingLimit: ranking?.default_limit != null ? String(ranking.default_limit) : '',
      trustTier: initial?.trustTier ?? '',
    },
  };
}

export function GlossaryEditForm({ initial, onSubmit, saving, i18n }: Props) {
  const [values, setValues] = useState<FormValues>(() => toForm(initial));

  useEffect(() => setValues(toForm(initial)), [initial?.id, initial?.updatedAt]);

  function set<K extends keyof FormValues>(k: K, v: FormValues[K]) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  function setConcept(patch: Partial<ConceptTierValues>) {
    setValues((prev) => ({ ...prev, concept: { ...prev.concept, ...patch } }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (typeof window !== 'undefined' && values.editorName.trim()) {
      setPref(EDITOR_KEY, values.editorName.trim());
    }
    onSubmit(values);
  }

  const canSave = values.label.trim().length > 0 && values.description.trim().length > 0;

  return (
    <Form id="glossary-edit-form" onSubmit={submit}>
      <StatusRow>
        <GlossaryStatusToggle
          status={values.status}
          onChange={(s) => set('status', s)}
          labelDraft={i18n.statusDraft}
          labelOfficial={i18n.statusOfficial}
        />
        <Field as="div" style={{ flex: 1, marginLeft: 16 }}>
          {i18n.editorName}
          <Input
            type="text"
            value={values.editorName}
            onChange={(e) => set('editorName', e.target.value.slice(0, 80))}
          />
        </Field>
      </StatusRow>
      <Row>
        <Field>
          {i18n.label}
          <Input value={values.label} onChange={(e) => set('label', e.target.value.slice(0, 80))} required />
        </Field>
        <Field>
          {i18n.labelVi}
          <Input
            value={values.labelVi}
            onChange={(e) => set('labelVi', e.target.value.slice(0, 80))}
            placeholder={i18n.viPlaceholder}
          />
        </Field>
      </Row>
      <Row>
        <Field>
          {i18n.description}
          <TextArea
            value={values.description}
            onChange={(e) => set('description', e.target.value.slice(0, 500))}
            required
          />
        </Field>
        <Field>
          {i18n.descriptionVi}
          <TextArea
            value={values.descriptionVi}
            onChange={(e) => set('descriptionVi', e.target.value.slice(0, 500))}
            placeholder={i18n.viPlaceholder}
          />
        </Field>
      </Row>
      <Row>
        <Field>
          {i18n.aliases}
          <GlossaryAliasChips
            value={values.aliases}
            onChange={(v) => set('aliases', v)}
            placeholder={i18n.aliasPlaceholder}
          />
        </Field>
        <Field>
          {i18n.aliasesVi}
          <GlossaryAliasChips
            value={values.aliasesVi}
            onChange={(v) => set('aliasesVi', v)}
            placeholder={i18n.aliasPlaceholderVi}
          />
        </Field>
      </Row>
      <Row>
        <Field>
          {i18n.primaryCatalogId}
          <Input
            value={values.primaryCatalogId}
            onChange={(e) => set('primaryCatalogId', e.target.value.slice(0, 128))}
          />
        </Field>
        <Field>
          {i18n.category}
          <Input value={values.category} onChange={(e) => set('category', e.target.value.slice(0, 64))} />
        </Field>
      </Row>
      <GlossaryConceptTierSection values={values.concept} onChange={setConcept} />
      <input type="submit" hidden disabled={saving || !canSave} aria-label={i18n.save} />
    </Form>
  );
}
