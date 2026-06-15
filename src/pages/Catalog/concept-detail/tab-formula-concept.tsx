/**
 * Concept Formula tab — placeholder YAML-like view derived from /meta.
 * Real Cube YAML (with `sql:` expressions) isn't exposed by /meta; we show
 * the next-best shape: the meta record as YAML-ish key/value. Compiled-SQL
 * preview (Cube /sql endpoint) lands later when the proxy is wired.
 */

import styled from 'styled-components';

import type { Concept } from '../data-model-tab/concept-types';

const Wrap = styled.div`
  padding: 20px 24px;
`;

const Pre = styled.pre`
  margin: 0;
  padding: 16px;
  border: 1px solid var(--border-card);
  border-radius: 8px;
  background: var(--bg-app);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
`;

const Note = styled.p`
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--text-muted);
`;

function toYamlIsh(concept: Concept): string {
  const lines: string[] = [];
  lines.push(`# ${concept.fqn}`);
  lines.push(`type: ${concept.type}`);
  lines.push(`cube: ${concept.cube}`);
  lines.push(`name: ${concept.name}`);
  if (concept.title) lines.push(`title: ${JSON.stringify(concept.title)}`);
  if (concept.description) lines.push(`description: ${JSON.stringify(concept.description)}`);
  if (concept.meta?.aggType) lines.push(`agg: ${concept.meta.aggType}`);
  if (concept.meta?.format) lines.push(`format: ${concept.meta.format}`);
  if (concept.meta?.dimensionType) lines.push(`dimension_type: ${concept.meta.dimensionType}`);
  return lines.join('\n');
}

export function TabFormulaConcept({ concept }: { concept: Concept }) {
  return (
    <Wrap>
      <Note>
        Read-only view from /meta. Compiled SQL lands when the Cube /sql proxy
        is wired (Phase 8).
      </Note>
      <Pre>{toYamlIsh(concept)}</Pre>
    </Wrap>
  );
}
