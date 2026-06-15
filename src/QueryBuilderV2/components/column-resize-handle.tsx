import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

import { clampColumnWidth } from '../hooks/use-column-widths';

// Sits on the right edge of a ColumnHeader. ColumnHeader uses
// `position: sticky` which establishes a positioning context for this
// absolute child — keep the header sticky or update this anchor.
const Handle = styled.div<{ $active: boolean }>`
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 3;
  user-select: none;
  touch-action: none;

  &::after {
    content: '';
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 2px;
    width: 2px;
    background: ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
    border-radius: 2px;
    transition: background 0.12s ease;
  }

  &:hover::after {
    background: ${(p) => (p.$active ? 'var(--brand)' : 'var(--fill-faint)')};
  }
`;

type Props = {
  name: string;
  getStartWidth: () => number;
  onResize: (w: number) => void;
  onCommit: (w: number) => void;
  onCancel: () => void;
};

export function ColumnResizeHandle({
  name,
  getStartWidth,
  onResize,
  onCommit,
  onCancel,
}: Props) {
  const [active, setActive] = useState(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);
  const currentWRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const onMove = (e: PointerEvent) => {
      const next = clampColumnWidth(
        startWRef.current + (e.clientX - startXRef.current)
      );
      currentWRef.current = next;
      onResize(next);
    };
    const finish = (commit: boolean) => {
      setActive(false);
      document.body.style.cursor = '';
      if (commit) {
        onCommit(currentWRef.current);
      } else {
        onCancel();
      }
    };
    const onUp = () => finish(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        finish(false);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [active, onResize, onCommit, onCancel]);

  return (
    <Handle
      $active={active}
      data-column={name}
      aria-label={`Resize column ${name}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        startXRef.current = e.clientX;
        startWRef.current = getStartWidth();
        currentWRef.current = startWRef.current;
        document.body.style.cursor = 'col-resize';
        setActive(true);
      }}
    />
  );
}
