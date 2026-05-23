/**
 * TypeIcon — distinguishes the 4 concept kinds (measure / dimension /
 * segment / business-metric) at a glance. Maps to lucide icons.
 */

import { BarChart3, Hash, Sparkles, Users } from 'lucide-react';
import styled from 'styled-components';

export type ConceptKind = 'measure' | 'dimension' | 'segment' | 'business-metric';

const Wrap = styled.span<{ $kind: ConceptKind }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: ${(p) =>
    p.$kind === 'business-metric'
      ? 'rgba(240,90,34,0.12)'
      : p.$kind === 'measure'
      ? 'rgba(63,141,255,0.12)'
      : p.$kind === 'dimension'
      ? 'rgba(168,85,247,0.12)'
      : 'rgba(20,184,166,0.12)'};
  color: ${(p) =>
    p.$kind === 'business-metric'
      ? '#f05a22'
      : p.$kind === 'measure'
      ? '#1d4ed8'
      : p.$kind === 'dimension'
      ? '#7e22ce'
      : '#0f766e'};
`;

const ICONS: Record<ConceptKind, typeof BarChart3> = {
  'business-metric': Sparkles,
  measure: BarChart3,
  dimension: Hash,
  segment: Users,
};

const LABELS: Record<ConceptKind, string> = {
  'business-metric': 'Business metric',
  measure: 'Measure',
  dimension: 'Dimension',
  segment: 'Segment',
};

export function TypeIcon({ kind }: { kind: ConceptKind }) {
  const Icon = ICONS[kind];
  return (
    <Wrap $kind={kind} title={LABELS[kind]} data-concept-kind={kind}>
      <Icon size={13} strokeWidth={2.5} />
    </Wrap>
  );
}
