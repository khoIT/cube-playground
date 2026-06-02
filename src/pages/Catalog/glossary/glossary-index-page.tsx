/**
 * Glossary index page — `/catalog/glossary`. Lists canonical terms with
 * search, category filter, status filter (All / Draft / Official), and an
 * inline editor modal launched from either the toolbar "New" button or any
 * row's edit icon. Terms refresh after each successful mutation; ETag on
 * the list endpoint keeps the network cost minimal.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { Plus } from 'lucide-react';
import {
  listGlossary,
  type GlossaryStatus,
  type GlossaryTerm,
} from '../../../api/glossary-client';
import { GlossaryRow } from './glossary-row';
import { GlossarySearch } from './glossary-search';
import { GlossaryStatusFilter } from './glossary-status-filter';
import { GlossaryEditModal } from './glossary-edit-modal';
import { useGlossaryMutations } from './use-glossary-mutations';
import type { FormValues } from './glossary-edit-form';
import { parseConceptTier } from './glossary-concept-tier-section';

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-app);
`;

const Header = styled.div`
  padding: 20px 24px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-sans);
`;

const Subtitle = styled.p`
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
  font-family: var(--font-sans);
`;

const FilterRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const NewBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--brand);
  background: var(--brand);
  color: var(--brand-on, white);
  font-size: 13px;
  font-weight: 500;
  padding: 6px 14px;
  border-radius: var(--radius-pill, 999px);
  cursor: pointer;
  font-family: var(--font-sans);
  &:hover { filter: brightness(0.95); }
`;

const List = styled.div`
  flex: 1;
  overflow-y: auto;
  border-top: 1px solid var(--border-subtle);

  /* Transient highlight applied to the row a #<id> anchor lands on. */
  [data-glossary-id].glossary-anchor-hit {
    animation: glossary-anchor-flash 2s ease-out;
  }
  @keyframes glossary-anchor-flash {
    0%,
    35% {
      background: var(--brand-soft, rgba(240, 90, 34, 0.12));
    }
    100% {
      background: transparent;
    }
  }
`;

const Status = styled.div`
  padding: 32px 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
`;

export function GlossaryIndexPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<GlossaryStatus | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GlossaryTerm | undefined>(undefined);
  const mutations = useGlossaryMutations();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listGlossary(undefined, statusFilter ? { status: statusFilter } : undefined);
      setTerms(items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of terms) if (t.category) set.add(t.category);
    return Array.from(set).sort();
  }, [terms]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return terms.filter((t) => {
      if (category && t.category !== category) return false;
      if (!q) return true;
      const hay = [
        t.label,
        t.description,
        t.labelVi ?? '',
        t.descriptionVi ?? '',
        ...t.aliases,
        ...t.aliasesVi,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [terms, query, category]);

  // Deep-link support: a `#<id>` anchor (e.g. /catalog/glossary#whale) scrolls
  // to that term's row and flashes it once the list has rendered. No-op when
  // the row is filtered out or the hash is empty.
  useEffect(() => {
    const id = location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
    if (!id || loading) return;
    const row = document.querySelector<HTMLElement>(
      `[data-glossary-id="${CSS.escape(id)}"]`,
    );
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('glossary-anchor-hit');
    const timer = window.setTimeout(() => row.classList.remove('glossary-anchor-hit'), 2000);
    return () => window.clearTimeout(timer);
    // `terms` (not `filtered`) so the flash fires once when the list loads,
    // not again on every search keystroke (which only re-derives `filtered`).
  }, [location.hash, loading, terms]);

  function openCreate() {
    setEditing(undefined);
    mutations.resetError();
    setModalOpen(true);
  }

  function openEdit(term: GlossaryTerm) {
    setEditing(term);
    mutations.resetError();
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    mutations.resetError();
  }

  async function onSave(values: FormValues) {
    const editorName = values.editorName.trim() || undefined;
    const concept = parseConceptTier(values.concept);
    const payload = {
      label: values.label,
      description: values.description,
      labelVi: values.labelVi.trim() || null,
      descriptionVi: values.descriptionVi.trim() || null,
      primaryCatalogId: values.primaryCatalogId.trim() || null,
      category: values.category.trim() || null,
      aliases: values.aliases,
      aliasesVi: values.aliasesVi,
      editorName,
      // Concept tier (all nullable; omit filter when JSON parse failed)
      entityCube: concept.entityCube,
      entityPk: concept.entityPk,
      defaultMeasureRef: concept.defaultMeasureRef,
      defaultFilter: concept.filterError ? undefined : concept.defaultFilter,
      ranking: concept.ranking,
      trustTier: concept.trustTier,
    };
    const saved = editing
      ? await mutations.update(editing.id, payload)
      : await mutations.create(payload);
    if (!saved) return;
    // Status flips are a separate endpoint; apply if changed.
    if (saved.status !== values.status) {
      const promoted = await mutations.setStatus(saved.id, values.status, editorName);
      if (!promoted) return;
    }
    closeModal();
    await reload();
  }

  async function onDelete() {
    if (!editing) return;
    const ok = await mutations.remove(editing.id);
    if (!ok) return;
    closeModal();
    await reload();
  }

  return (
    <Page>
      <Header>
        <TitleRow>
          <div>
            <Title>{t('glossary.title', { defaultValue: 'Glossary' })}</Title>
            <Subtitle>
              {t('glossary.subtitle', {
                defaultValue:
                  'Canonical business terms used across chat answers, catalog cards, and Question Studio.',
              })}
            </Subtitle>
          </div>
          <NewBtn type="button" onClick={openCreate}>
            <Plus size={14} aria-hidden />
            {t('glossary.actions.new', { defaultValue: 'New term' })}
          </NewBtn>
        </TitleRow>
        <FilterRow>
          <div style={{ flex: 1 }}>
            <GlossarySearch
              query={query}
              onQueryChange={setQuery}
              category={category}
              onCategoryChange={setCategory}
              categories={categories}
            />
          </div>
          <GlossaryStatusFilter
            value={statusFilter}
            onChange={setStatusFilter}
            labelAll={t('glossary.statusFilter.all', { defaultValue: 'All' })}
            labelDraft={t('glossary.status.draft', { defaultValue: 'Draft' })}
            labelOfficial={t('glossary.status.official', { defaultValue: 'Official' })}
          />
        </FilterRow>
      </Header>
      <List>
        {loading ? <Status>{t('glossary.loading', { defaultValue: 'Loading…' })}</Status> : null}
        {error ? <Status>{t('glossary.loadFailed', { defaultValue: 'Failed to load: {{msg}}', msg: error })}</Status> : null}
        {!loading && !error && filtered.length === 0 ? (
          <Status>{t('glossary.empty', { defaultValue: 'No terms match.' })}</Status>
        ) : null}
        {filtered.map((term) => (
          <GlossaryRow
            key={term.id}
            term={term}
            onEdit={openEdit}
            editLabel={t('glossary.actions.edit', { defaultValue: 'Edit' })}
            draftLabel={t('glossary.status.draft', { defaultValue: 'Draft' })}
            officialLabel={t('glossary.status.official', { defaultValue: 'Official' })}
          />
        ))}
      </List>
      <GlossaryEditModal
        open={modalOpen}
        initial={editing}
        onClose={closeModal}
        onSave={onSave}
        onDelete={editing && editing.source === 'user' ? onDelete : undefined}
        saving={mutations.saving}
        errorMessage={mutations.error}
      />
    </Page>
  );
}
