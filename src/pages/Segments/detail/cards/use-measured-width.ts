/**
 * Measure a container's pixel width so SVG charts can render pixel-true
 * (1 viewBox unit = 1px) instead of stretching a fixed viewBox — stretching
 * scales fonts/dots/bands with the card and looks broken on wide layouts.
 * Falls back to the provided default in jsdom (no layout, width 0).
 */

import { useLayoutEffect, useRef, useState } from 'react';

export function useMeasuredWidth<T extends HTMLElement>(fallback = 640): {
  ref: React.RefObject<T | null>;
  width: number;
} {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width: width > 0 ? width : fallback };
}
