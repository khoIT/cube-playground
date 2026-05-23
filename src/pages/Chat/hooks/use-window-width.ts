/**
 * useWindowWidth — returns the current window inner width, updated on resize.
 * Lightweight alternative to react-responsive for a single breakpoint check.
 */
import { useEffect, useState } from 'react';

export function useWindowWidth(): number {
  const [width, setWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  );

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return width;
}
