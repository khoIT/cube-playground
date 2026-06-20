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
import { saveOverlayForPrimary, primaryQueryKey } from '../../../QueryBuilderV2/overlay-deeplink-store';

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
    } catch {
      // sessionStorage quota/unavailable — proceed anyway; /build will show stale toast.
    }
    // Combined artifact: store the overlay query in a DURABLE store keyed by the
    // PRIMARY query's identity (not the artifact id or a URL param). The builder
    // rewrites its URL to ?query=<primary> as soon as the query runs, so keying
    // by the primary lets /build re-attach the overlay from the active tab's
    // query — surviving that rewrite AND a page refresh. The primary payload
    // stays a runnable single CubeQuery so a consumer that ignores it still works.
    if (artifact.combined && artifact.overlay !== undefined) {
      saveOverlayForPrimary(primaryQueryKey(artifact.query), artifact.overlay);
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
