/**
 * useDevAuditShortcuts — keyboard shortcuts for the chat-audit route subtree.
 *
 * Only active when the current pathname starts with the shell's base path
 * (default /dev/chat-audit; the admin mount passes /admin/dev/chat-audit).
 * Currently wires cmd-K (or ctrl-K on non-mac) to focus the unified search.
 *
 * Callers pass a callback invoked when cmd-K fires inside the subtree.
 * The shell uses this to navigate to /search and focus the input.
 *
 * Cleans up the document event listener on unmount.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

interface Options {
  /** Called when cmd-K fires while inside the chat-audit route subtree. */
  onCmdK: () => void;
  /** Route prefix to scope the shortcut to (default standalone /dev/chat-audit). */
  basePath?: string;
}

export function useDevAuditShortcuts({ onCmdK, basePath = '/dev/chat-audit' }: Options): void {
  const location = useLocation();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only intercept within the chat-audit route subtree
      if (!location.pathname.startsWith(basePath)) return;

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
    // Re-register whenever pathname, callback, or base path changes
  }, [location.pathname, onCmdK, basePath]);
}
