/**
 * SmartSearchOverlay — portal-rendered ⌘K palette. Searches over the
 * loaded business-metrics registry + active-game Cube concepts. Keyboard
 * nav: ↑/↓ to select, Enter to open, Esc to dismiss (registered in
 * SmartSearchProvider).
 *
 * Performance: scorer is pure substring over typical pool sizes (~25
 * metrics + ~200 concepts), well under 1ms.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useHistory } from 'react-router-dom';
import { Search, Sparkles } from 'lucide-react';
import styled from 'styled-components';

import { useConcepts } from '../../pages/Catalog/data-model-tab/use-concepts';
import { useBusinessMetrics } from '../../pages/Catalog/metrics-tab/use-business-metrics';
import { TypeIcon } from '../concept-shell/type-icon';
import { scoreAll } from './search-scorer';
import { useSmartSearch } from './smart-search-context';
import type { SearchResult } from './search-types';

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(15, 15, 15, 0.55);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  z-index: 9999;
`;

const Modal = styled.div`
  width: min(640px, 92vw);
  max-height: 70vh;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-card);
`;

const Input = styled.input`
  flex: 1;
  border: none;
  outline: none;
  font-size: 15px;
  background: transparent;
  color: var(--text-primary);
`;

const Shortcut = styled.kbd`
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  border: 1px solid var(--border-card);
  border-radius: 4px;
  padding: 1px 6px;
  color: var(--text-muted);
`;

const ResultsList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  flex: 1;
`;

const GroupTitle = styled.li`
  padding: 8px 16px 4px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
`;

const Row = styled.li<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  cursor: pointer;
  background: ${(p) => (p.$active ? 'rgba(240, 90, 34, 0.08)' : 'transparent')};

  &:hover {
    background: rgba(240, 90, 34, 0.08);
  }
`;

const RowLabel = styled.span`
  font-weight: 500;
  color: var(--text-primary);
  font-family: var(--font-mono, monospace);
  font-size: 13px;
`;

const RowSub = styled.span`
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Empty = styled.div`
  padding: 28px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--border-card);
  background: var(--bg-app);
  font-size: 11.5px;
  color: var(--text-muted);
`;

const FooterStrong = styled.span`
  color: var(--brand);
  font-weight: 500;
`;

function groupResults(results: SearchResult[]) {
  return {
    metric: results.filter((r) => r.kind === 'metric'),
    concept: results.filter((r) => r.kind === 'concept'),
  };
}

export function SmartSearchOverlay() {
  const { isOpen, close } = useSmartSearch();
  const { metrics } = useBusinessMetrics();
  const { concepts } = useConcepts();
  const history = useHistory();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(
    () => scoreAll(query, { metrics, concepts }),
    [query, metrics, concepts],
  );

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActive(0);
      // Defer focus so the input mount completes first.
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        const r = results[active];
        if (r) {
          e.preventDefault();
          history.push(r.routeTo);
          close();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, results, active, history, close]);

  if (!isOpen) return null;

  const grouped = groupResults(results);

  const overlay = (
    <Backdrop
      role="dialog"
      aria-modal="true"
      aria-label="Smart search"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <Modal onMouseDown={(e) => e.stopPropagation()}>
        <Header>
          <Search size={16} color="var(--text-muted)" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search metrics, dimensions, segments…"
            aria-label="Smart search query"
          />
          <Shortcut>esc</Shortcut>
        </Header>
        <ResultsList>
          {query.trim() === '' && (
            <Empty>
              Type to search across metrics &amp; concepts. Use ↑↓ to move,
              Enter to open.
            </Empty>
          )}
          {query.trim() !== '' && results.length === 0 && (
            <Empty>No matches for “{query}”.</Empty>
          )}
          {grouped.metric.length > 0 && <GroupTitle>Business metrics</GroupTitle>}
          {grouped.metric.map((r) => {
            const idx = results.indexOf(r);
            return (
              <Row
                key={r.id}
                $active={idx === active}
                role="option"
                aria-selected={idx === active}
                onMouseEnter={() => setActive(idx)}
                onClick={() => {
                  history.push(r.routeTo);
                  close();
                }}
              >
                <TypeIcon kind="business-metric" />
                <RowLabel>{r.label}</RowLabel>
                <RowSub>{r.sublabel}</RowSub>
              </Row>
            );
          })}
          {grouped.concept.length > 0 && <GroupTitle>Concepts</GroupTitle>}
          {grouped.concept.map((r) => {
            const idx = results.indexOf(r);
            const conceptKind = r.id.split(':')[0] as
              | 'measure'
              | 'dimension'
              | 'segment';
            return (
              <Row
                key={r.id}
                $active={idx === active}
                role="option"
                aria-selected={idx === active}
                onMouseEnter={() => setActive(idx)}
                onClick={() => {
                  history.push(r.routeTo);
                  close();
                }}
              >
                <TypeIcon kind={conceptKind} />
                <RowLabel>{r.label}</RowLabel>
                <RowSub>{r.sublabel}</RowSub>
              </Row>
            );
          })}
        </ResultsList>
        <Footer>
          <Sparkles size={12} />
          <FooterStrong>Coming next:</FooterStrong>
          multi-step agent for ad-hoc analysis questions.
        </Footer>
      </Modal>
    </Backdrop>
  );

  return createPortal(overlay, document.body);
}
