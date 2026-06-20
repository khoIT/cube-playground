/**
 * Shared "Open in Playground" navigation for query artifacts.
 *
 * Used by the chat QueryArtifactCard and the chat-audit TurnArtifactsSection
 * so both surfaces deeplink identically:
 *   - session-storage artifacts write their payload to sessionStorage BEFORE
 *     navigation (the /build page consumes it on mount)
 *   - a per-click nonce lets the playground re-consume the same artifact on a
 *     repeat click instead of the once-per-artifact guard swallowing it
 */
import type { QueryArtifact } from '../../../api/chat-sse-client';

export function openArtifactInPlayground(
  artifact: QueryArtifact,
  history: { push: (path: string) => void },
): void {
  if (artifact.deeplinkVia === 'session-storage') {
    try {
      sessionStorage.setItem(
        `gds-cube:pending-chat-deeplink:${artifact.id}`,
        JSON.stringify(artifact.payload),
      );
      // Combined artifact: the overlay query rides a sibling key (the primary
      // payload above stays a runnable single CubeQuery for graceful degrade).
      // The deeplink URL already carries &combined=1 so /build reads this key.
      if (artifact.combined && artifact.overlay !== undefined) {
        sessionStorage.setItem(
          `gds-cube:pending-chat-deeplink-overlay:${artifact.id}`,
          JSON.stringify(artifact.overlay),
        );
      }
    } catch {
      // sessionStorage quota/unavailable — proceed anyway; /build will show stale toast.
    }
  }
  // deeplinkUrl is "#/build?..." — strip the leading '#' for react-router-dom v5.
  const path = artifact.deeplinkUrl.startsWith('#')
    ? artifact.deeplinkUrl.slice(1)
    : artifact.deeplinkUrl;
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const sep = path.includes('?') ? '&' : '?';
  history.push(`${path}${sep}n=${nonce}`);
}
