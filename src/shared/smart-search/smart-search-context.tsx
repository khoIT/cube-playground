/**
 * SmartSearchProvider — context exposing { isOpen, open, close }. The
 * actual search pool + scoring lives inside the overlay component so we
 * only fetch business-metrics + /meta when the overlay opens. ⌘K shortcut
 * registered globally at the provider level.
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

interface SmartSearchContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const Ctx = createContext<SmartSearchContextValue | null>(null);

function isInputTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function SmartSearchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);

  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isK = e.key === 'k' || e.key === 'K';
      if (!isK) return;
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;
      // Allow ⌘K from inputs — Compass UX expects it always works.
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [isOpen]);

  return (
    <Ctx.Provider value={{ isOpen, open, close }}>{children}</Ctx.Provider>
  );
}

export function useSmartSearch(): SmartSearchContextValue {
  const v = useContext(Ctx);
  if (!v) {
    // Fallback no-op so components in tests that don't wrap the provider
    // still render without throwing. Disabling the trigger is the desired
    // failure mode.
    return {
      isOpen: false,
      open: () => {},
      close: () => {},
    };
  }
  return v;
}

// Suppress the unused isInputTarget warning — kept for future scope where
// we might want input-aware behaviour but no current call site needs it.
void isInputTarget;
