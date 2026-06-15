import { ReactNode, useState, useRef } from 'react';
import styled from 'styled-components';
import { AggTypeChip } from './agg-type-chip';

const Wrapper = styled.span`
  position: relative;
  display: inline-block;
  width: 100%;
`;

const Pop = styled.div<{ $visible: boolean }>`
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 50;
  min-width: 220px;
  max-width: 320px;
  padding: 10px 12px;
  background: var(--surface-inverse);
  color: var(--text-inverse);
  font-size: 12px;
  line-height: 1.4;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-sm);
  opacity: ${(p) => (p.$visible ? 1 : 0)};
  pointer-events: none;
  transition: opacity 80ms ease;
  display: ${(p) => (p.$visible ? 'block' : 'none')};
`;

const Title = styled.div`
  font-weight: 600;
  margin-bottom: 4px;
`;

const Description = styled.div`
  color: var(--text-inverse-dim);
  margin-bottom: 6px;
`;

const Meta = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
`;

const Hint = styled.span`
  font-size: 10.5px;
  color: var(--fill-muted);
`;

interface MeasureTooltipProps {
  title?: string;
  description?: string;
  aggType?: string;
  format?: string;
  children: ReactNode;
  showAfterMs?: number;
}

/**
 * Lightweight hover tooltip for measure rows. Light-touch implementation —
 * does NOT use ui-kit's Tooltip (which collides with the existing
 * InstanceTooltipProvider on the same row). Shows after 250ms hover.
 *
 * Renders nothing visible until first hover so it's invisible to keyboard nav.
 */
export function MeasureTooltip({
  title,
  description,
  aggType,
  format,
  children,
  showAfterMs = 250,
}: MeasureTooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | null>(null);

  function onEnter() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(true), showAfterMs);
  }
  function onLeave() {
    if (timer.current) window.clearTimeout(timer.current);
    setVisible(false);
  }

  const hasContent = Boolean(title || description || aggType || format);

  return (
    <Wrapper onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {children}
      {hasContent && (
        <Pop $visible={visible} role="tooltip">
          {title && <Title>{title}</Title>}
          {description && <Description>{description}</Description>}
          <Meta>
            {aggType && <AggTypeChip aggType={aggType} />}
            {format && <Hint>format: {format}</Hint>}
          </Meta>
        </Pop>
      )}
    </Wrapper>
  );
}
