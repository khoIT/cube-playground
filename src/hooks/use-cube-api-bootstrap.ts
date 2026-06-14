/**
 * Pushes apiUrl + token into AppContext for any route that needs to talk
 * to Cube directly (Explore, Segments). Without this, useCubejsApi returns
 * null and every Cube call silently no-ops.
 *
 * Extracted from ExplorePage so the Segments route can mount without
 * requiring the user to visit /build first.
 */

import { useAppContext } from './app-context';
import { useSecurityContext } from './security-context';
import { useDeepEffect } from './deep-effect';

export function buildApiUrl(apiUrl: string, basePath = '/cubejs-api'): string {
  return `${apiUrl}${basePath}/v1`;
}

export function useCubeApiBootstrap(): void {
  const { setContext, playgroundContext } = useAppContext();
  const { token: securityContextToken } = useSecurityContext();

  const { basePath, cubejsToken } = playgroundContext;

  useDeepEffect(() => {
    if (!basePath) return;
    setContext({
      token: securityContextToken || cubejsToken,
      apiUrl: buildApiUrl(
        // Collapse ALL trailing slashes, not just one: a double-slash origin
        // (e.g. landing on `http://host//#/…`) would otherwise leave one slash
        // and produce a `//cube-api/v1/…` fetch path, which the dev proxy
        // (matches the `/cube-api` prefix) skips — the SPA fallback then serves
        // index.html and meta JSON parsing fails on `<!doctype`.
        window.location.href.split('#')[0].replace(/\/+$/, ''),
        basePath,
      ),
    });
  }, [basePath, cubejsToken, securityContextToken]);
}
