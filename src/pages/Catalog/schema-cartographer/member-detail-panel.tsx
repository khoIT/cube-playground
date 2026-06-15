/**
 * MemberDetailPanel — read-only view of a selected cube member. Links into
 * the existing concept-detail route when the member type maps to a
 * known Concept kind (measure / dimension / segment).
 *
 * The bottom section fetches and renders cross-layer reverse edges (metrics,
 * glossary terms, app segments) via ConceptRelationsSection so users can
 * navigate any direction from a selected field.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import type { CartographerMember } from './use-cartographer-index';
import { ConceptRelationsSection } from './concept-relations-section';
import type { LayerFilter } from './layer-filter-pills';

interface Props {
  member: CartographerMember;
  joinableCubes: ReadonlyArray<string>;
  /** Which reverse-edge sections to show (Metrics / Glossary / Segments). */
  visibleLayers: ReadonlySet<LayerFilter>;
}

const Panel = styled.aside`
  width: 380px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-card);
  padding: 20px;
  background: var(--bg-card);
  font-family: var(--font-sans);
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
`;

const Divider = styled.hr`
  border: none;
  border-top: 1px solid var(--border-card);
  margin: 4px 0;
`;

const FieldLabel = styled.div`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 2px;
`;

const FieldValue = styled.div`
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-word;
`;

export function MemberDetailPanel({ member, joinableCubes, visibleLayers }: Props) {
  const conceptHref = `/catalog/concept/${member.kind}/${encodeURIComponent(member.fqn)}`;
  // Build a namespaced concept ref so ConceptRelationsSection can fetch cross-layer edges.
  const conceptRef = `data_model/${member.fqn}`;
  return (
    <Panel>
      <div>
        <FieldLabel>{member.kind}</FieldLabel>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>
          {member.title ?? member.memberName}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{member.fqn}</div>
      </div>

      {member.description ? (
        <div>
          <FieldLabel>Description</FieldLabel>
          <FieldValue>{member.description}</FieldValue>
        </div>
      ) : null}

      {member.type ? (
        <div>
          <FieldLabel>Type</FieldLabel>
          <FieldValue>{member.type}</FieldValue>
        </div>
      ) : null}

      {member.aggType ? (
        <div>
          <FieldLabel>Aggregation</FieldLabel>
          <FieldValue>{member.aggType}</FieldValue>
        </div>
      ) : null}

      {joinableCubes.length > 0 ? (
        <div>
          <FieldLabel>Joinable cubes</FieldLabel>
          <FieldValue>
            {joinableCubes.map((c, i) => (
              <span key={c}>
                {i > 0 ? ', ' : ''}
                {c}
              </span>
            ))}
          </FieldValue>
        </div>
      ) : null}

      <div style={{ marginTop: 8 }}>
        <Link
          to={conceptHref}
          style={{
            display: 'inline-block',
            padding: '8px 14px',
            borderRadius: 8,
            background: 'var(--brand)',
            color: 'var(--text-on-brand)',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Open in concept detail →
        </Link>
      </div>

      <Divider />

      {/* Cross-layer reverse edges — metrics, glossary terms, app segments. */}
      <ConceptRelationsSection conceptRef={conceptRef} visibleLayers={visibleLayers} />
    </Panel>
  );
}
