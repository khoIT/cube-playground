import styled, { css } from 'styled-components';
import type { ArtifactKind } from '../types';

const ICON: Record<ArtifactKind, string> = {
  measure: 'M',
  dimension: 'D',
  segment: 'S',
};

const TITLE: Record<ArtifactKind, string> = {
  measure: 'measure',
  dimension: 'dimension',
  segment: 'segment',
};

const Pill = styled.span<{ $kind: ArtifactKind; $compact: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: ${(p) => (p.$compact ? '1px 5px' : '2px 8px')};
  border-radius: 999px;
  font-size: ${(p) => (p.$compact ? '10px' : '11px')};
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0.02em;
  text-transform: lowercase;
  white-space: nowrap;

  ${(p) =>
    p.$kind === 'measure' &&
    css`
      background: rgba(16, 185, 129, 0.12);
      color: #047857;
    `}
  ${(p) =>
    p.$kind === 'dimension' &&
    css`
      background: rgba(37, 99, 235, 0.12);
      color: #1d4ed8;
    `}
  ${(p) =>
    p.$kind === 'segment' &&
    css`
      background: rgba(139, 92, 246, 0.12);
      color: #6d28d9;
    `}
`;

const Glyph = styled.span`
  display: inline-flex;
  width: 13px;
  height: 13px;
  border-radius: 3px;
  background: currentColor;
  color: var(--bg-card);
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 800;
`;

export type KindBadgeProps = {
  kind: ArtifactKind;
  compact?: boolean;
  className?: string;
};

export function KindBadge({ kind, compact = false, className }: KindBadgeProps) {
  return (
    <Pill
      $kind={kind}
      $compact={compact}
      className={className}
      role="img"
      aria-label={TITLE[kind]}
      title={TITLE[kind]}
    >
      <Glyph aria-hidden>{ICON[kind]}</Glyph>
      {!compact && <span>{TITLE[kind]}</span>}
    </Pill>
  );
}
