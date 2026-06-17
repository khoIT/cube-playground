/**
 * Settings → Glossary link integrity. Lists glossary terms whose catalog refs
 * no longer resolve — the "dead chat-chip link" class (a term linking to a
 * metric/segment that doesn't exist). Primary refs are the dangerous ones: they
 * drive the term's click target, so a dangling primary = a chip that lands on
 * "no metric found". Read-on-demand, mirroring the Metric coverage section.
 */
import { ReactElement } from 'react';

import { SectionCard, SectionHead, SectionTitle, SectionHint } from './section-card';
import { useGlossaryIntegrity } from './use-glossary-integrity';
import { Collapsible, Pill, Mono, Note } from './coverage-ui';
import { RefreshCw } from 'lucide-react';
import styled from 'styled-components';

const Btn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  &:hover:not(:disabled) { color: var(--brand); border-color: var(--brand); background: var(--brand-soft); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const PillBar = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 14px 0 4px;
`;

export function GlossaryIntegritySection(): ReactElement {
  const { report, loading, error, refetch } = useGlossaryIntegrity();

  const dangling = report?.dangling ?? [];
  const primary = dangling.filter((d) => d.slot === 'primary');
  const secondary = dangling.filter((d) => d.slot === 'secondary');

  return (
    <SectionCard>
      <SectionHead>
        <div>
          <SectionTitle>Glossary link integrity</SectionTitle>
          <SectionHint>
            Glossary terms whose catalog refs no longer resolve. A dangling{' '}
            <strong>primary</strong> ref is what makes a chat chip link to a “no metric found” page —
            fix it by creating the metric, repointing the ref, or clearing it in{' '}
            <a href="#/drift-center" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>
              Drift Center
            </a>
            .
          </SectionHint>
        </div>
        <Btn type="button" onClick={() => void refetch()} disabled={loading}>
          <RefreshCw size={13} /> {loading ? 'Syncing…' : 'Refresh'}
        </Btn>
      </SectionHead>

      {error ? <Pill $tone="danger">Failed to load: {error}</Pill> : null}

      {report ? (
        <>
          <PillBar>
            <Pill $tone={primary.length ? 'danger' : 'ok'}>{primary.length} dangling primary</Pill>
            <Pill $tone={secondary.length ? 'warn' : 'ok'}>{secondary.length} dangling secondary</Pill>
          </PillBar>

          <Collapsible
            title="Dangling primary refs"
            defaultOpen={primary.length > 0}
            meta={<Pill $tone={primary.length ? 'danger' : 'ok'}>{primary.length}</Pill>}
          >
            {primary.length === 0 ? (
              <Note>Every term’s primary link resolves.</Note>
            ) : (
              primary.map((d) => (
                <Note key={`${d.termId}.${d.ref}`}>
                  {d.label} (<Mono>{d.termId}</Mono>) → <Mono>{d.ref}</Mono>
                </Note>
              ))
            )}
          </Collapsible>

          <Collapsible
            title="Dangling secondary refs"
            meta={<Pill $tone={secondary.length ? 'warn' : 'ok'}>{secondary.length}</Pill>}
          >
            {secondary.length === 0 ? (
              <Note>Every term’s secondary refs resolve.</Note>
            ) : (
              secondary.map((d) => (
                <Note key={`${d.termId}.${d.ref}`}>
                  {d.label} (<Mono>{d.termId}</Mono>) → <Mono>{d.ref}</Mono>
                </Note>
              ))
            )}
          </Collapsible>
        </>
      ) : (
        !error && <Note>Loading integrity…</Note>
      )}
    </SectionCard>
  );
}

export default GlossaryIntegritySection;
