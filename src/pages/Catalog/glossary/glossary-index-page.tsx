/**
 * Glossary index page — `/catalog/glossary`. Lists the ~30 canonical terms
 * with search + category filter. Links each term to the concept-detail
 * route when a `primaryCatalogId` exists.
 */
import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { listGlossary, type GlossaryTerm } from '../../../api/glossary-client';
import { GlossaryRow } from './glossary-row';
import { GlossarySearch } from './glossary-search';

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

const List = styled.div`
  flex: 1;
  overflow-y: auto;
  border-top: 1px solid var(--border-subtle);
`;

const Status = styled.div`
  padding: 32px 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
`;

export function GlossaryIndexPage() {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listGlossary(controller.signal)
      .then((items) => {
        setTerms(items);
        setLoading(false);
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        setError((err as Error).message);
        setLoading(false);
      });
    return () => controller.abort();
  }, []);

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
      const hay = `${t.label} ${t.description} ${t.aliases.join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [terms, query, category]);

  return (
    <Page>
      <Header>
        <Title>Glossary</Title>
        <Subtitle>
          Canonical business terms used across chat answers, catalog cards, and Question Studio.
        </Subtitle>
        <GlossarySearch
          query={query}
          onQueryChange={setQuery}
          category={category}
          onCategoryChange={setCategory}
          categories={categories}
        />
      </Header>
      <List>
        {loading ? <Status>Loading…</Status> : null}
        {error ? <Status>Failed to load: {error}</Status> : null}
        {!loading && !error && filtered.length === 0 ? (
          <Status>No terms match.</Status>
        ) : null}
        {filtered.map((t) => (
          <GlossaryRow key={t.id} term={t} />
        ))}
      </List>
    </Page>
  );
}
