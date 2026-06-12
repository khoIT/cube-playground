/**
 * useDevAuditShortcuts — keyboard shortcuts for /dev/chat-audit/* routes.
 *
 * Only active when the current pathname starts with /dev/chat-audit.
 * Currently wires cmd-K (or ctrl-K on non-mac) to focus the unified search.
 *
 * Callers pass a callback invoked when cmd-K fires inside a dev-audit route.
 * The shell uses this to navigate to /search and focus the input.
 *
 * Cleans up the document event listener on unmount.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const DEV_AUDIT_PREFIX = '/dev/chat-audit';

interface Options {
  /** Called when cmd-K fires while inside a /dev/chat-audit route. */
  onCmdK: () => void;
}

export function useDevAuditShortcuts({ onCmdK }: Options): void {
  const location = useLocation();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only intercept within dev-audit routes
      if (!location.pathname.startsWith(DEV_AUDIT_PREFIX)) return;

      const isMac = typeof navigator !== 'undefined'
        ? navigator.platform.toUpperCase().includes('MAC')
        : false;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (modKey && e.key === 'k') {
        // Do not steal the shortcut while the user is composing text in an input,
        // textarea, or contentEditable — prevents yanking focus mid-annotation.
        const target = e.target as HTMLElement | null;
        // tagName may be undefined when the event target is the document node itself
        const tag = target?.tagName?.toUpperCase?.();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

        e.preventDefault();
        onCmdK();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
    // Re-register whenever pathname or callback changes
  }, [location.pathname, onCmdK]);
}
