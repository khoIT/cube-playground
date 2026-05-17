import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

const LEFT_W = 260;
const RIGHT_DEFAULT = 340;
const RIGHT_MIN = 240;
const RIGHT_MAX_RATIO = 0.55; // never wider than 55% of the viewport
const STORAGE_KEY = 'new-metric-page:right-rail-width';

const Layout = styled.div<{ $rightW: number }>`
  display: grid;
  grid-template-columns: ${LEFT_W}px 1fr 6px ${(p) => p.$rightW}px;
  /* App-shell <Header> above us is fixed at 44px (src/components/Header/Header.tsx).
     Subtracting it keeps the wizard footer pinned to the viewport instead of
     getting pushed below the fold when body content is tall. The wizard used
     to render its own 56px breadcrumb bar on top of the app header — that bar
     was decorative and stacked on top of the global header, so it has been
     dropped. Save / Help / Discard actions moved into the LeftRail footer.
  */
  height: calc(100vh - 44px);
  background: var(--bg-app);
  font-family: var(--font-sans);
  color: var(--text-primary);
`;

const LeftCol = styled.aside`
  background: var(--bg-app);
  border-right: 1px solid var(--border-card);
  overflow-y: auto;
  padding: 16px;
`;

const MainCol = styled.main`
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-app);
  min-width: 0;
`;

const Divider = styled.div<{ $dragging: boolean }>`
  cursor: col-resize;
  background: ${(p) => (p.$dragging ? 'var(--brand-soft)' : 'transparent')};
  border-left: 1px solid var(--border-card);
  border-right: 1px solid transparent;
  position: relative;
  transition: background-color 120ms;

  &:hover {
    background: var(--brand-soft);
  }

  &::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 2px;
    height: 32px;
    border-radius: 2px;
    background: var(--border-strong);
  }
`;

const RightCol = styled.aside`
  background: var(--bg-app);
  /* Divider owns the separator border (see Divider above) — adding one here
     would render a second parallel line across the resize gap. */
  overflow: hidden;
  min-width: 0;
`;

function clampRightWidth(w: number): number {
  if (typeof window === 'undefined') return w;
  const max = Math.max(RIGHT_MIN, Math.floor(window.innerWidth * RIGHT_MAX_RATIO));
  return Math.min(Math.max(w, RIGHT_MIN), max);
}

function readPersistedWidth(): number {
  if (typeof window === 'undefined') return RIGHT_DEFAULT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return clampRightWidth(Number.isFinite(n) ? n : RIGHT_DEFAULT);
}

export type ShellSlots = {
  leftRail: ReactNode;
  main: ReactNode;
  rightRail: ReactNode;
};

export function Shell({ leftRail, main, rightRail }: ShellSlots) {
  const [rightW, setRightW] = useState<number>(readPersistedWidth);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  // Persist on commit (drag end) rather than on every move — keeps localStorage
  // writes cheap and avoids spamming the page during a drag.
  useEffect(() => {
    if (!dragging) {
      try { window.localStorage.setItem(STORAGE_KEY, String(rightW)); } catch { /* ignore */ }
    }
  }, [rightW, dragging]);

  // Re-clamp on viewport resize so the right rail can't stay wider than the
  // current max ratio after the user shrinks their window.
  useEffect(() => {
    const onResize = () => setRightW((w) => clampRightWidth(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setDragging(true);

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      // Right edge of the page minus the cursor X = new right-rail width.
      const next = clampRightWidth(window.innerWidth - ev.clientX);
      setRightW(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onDoubleClick = useCallback(() => {
    setRightW(clampRightWidth(RIGHT_DEFAULT));
  }, []);

  return (
    <Layout $rightW={rightW}>
      <LeftCol>{leftRail}</LeftCol>
      <MainCol>{main}</MainCol>
      <Divider
        $dragging={dragging}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview panel (double-click to reset)"
        title="Drag to resize · double-click to reset"
      />
      <RightCol>{rightRail}</RightCol>
    </Layout>
  );
}
