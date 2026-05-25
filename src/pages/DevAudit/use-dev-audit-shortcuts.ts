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

      // Accept metaKey (Mac cmd) or ctrlKey (Win/Linux ctrl) — both are valid shortcuts.
      // In test environments (jsdom) navigator.platform is empty so we accept either.
      const modKey = e.metaKey || e.ctrlKey;

      if (modKey && e.key === 'k') {
        // Don't steal cmd-K when user is typing in an editable field.
        // Check e.target first (most reliable in test envs), fall back to activeElement.
        // UNLESS it's the unified search bar (marked with data-dev-audit-search).
        const rawTarget = e.target instanceof HTMLElement ? e.target : document.activeElement;
        const target = rawTarget instanceof HTMLElement ? rawTarget : null;
        if (target != null) {
          const isSearchBar = target.dataset?.devAuditSearch === 'true';
          if (!isSearchBar) {
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
            // isContentEditable is the spec API; contentEditable==='true' is the fallback
            // for environments (jsdom) where isContentEditable is not implemented.
            if (target.isContentEditable || target.contentEditable === 'true') return;
          }
        }

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
