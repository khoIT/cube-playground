import { describe, expect, it } from 'vitest';

import { buildApiUrl } from '../use-cube-api-bootstrap';

/**
 * buildApiUrl receives an origin already stripped of its trailing slash(es) by
 * the caller. These cases lock in that a double-slash origin (from landing on
 * `http://host//#/…`) does not leak into the fetch path as `//cube-api/…`,
 * which would bypass the dev proxy and make meta load index.html instead of JSON.
 */
describe('buildApiUrl', () => {
  it('appends basePath and /v1 to a clean origin', () => {
    expect(buildApiUrl('http://localhost:3000', '/cube-api')).toBe(
      'http://localhost:3000/cube-api/v1',
    );
  });

  it('does not introduce a double slash when the origin was normalized from a double-slash URL', () => {
    // Mirrors the caller: window.location.href.split('#')[0].replace(/\/+$/, '')
    const normalized = 'http://localhost:3000//'.replace(/\/+$/, '');
    const url = buildApiUrl(normalized, '/cube-api');
    expect(url).toBe('http://localhost:3000/cube-api/v1');
    expect(new URL(`${url}/meta`).pathname).toBe('/cube-api/v1/meta');
  });
});
