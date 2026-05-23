/**
 * Tests for build-chat-deeplink utility.
 */

import { describe, it, expect } from 'vitest';
import { buildChatDeeplink, STORAGE_KEY_PREFIX } from '../src/utils/build-chat-deeplink.js';
import type { CubeQuery } from '../src/types.js';

describe('buildChatDeeplink', () => {
  it('returns inline url for a small query', () => {
    const query: CubeQuery = {
      measures: ['Revenue.total'],
      timeDimensions: [{ dimension: 'Revenue.createdAt', granularity: 'day', dateRange: 'last 7 days' }],
    };

    const result = buildChatDeeplink(query);

    expect(result.via).toBe('inline');
    expect(result.url).toMatch(/^#\/build\?query=/);
    expect(result.url.length).toBeLessThanOrEqual(8000);
    expect(result.artifactId).toBeTruthy();
    expect(result.payload).toBeUndefined();
  });

  it('url contains encoded JSON of the query', () => {
    const query: CubeQuery = { measures: ['Orders.count'] };
    const result = buildChatDeeplink(query);
    const decoded = JSON.parse(decodeURIComponent(result.url.replace('#/build?query=', '')));
    expect(decoded).toMatchObject({ measures: ['Orders.count'] });
  });

  it('returns session-storage for a query that makes URL > 8000 chars', () => {
    // Build a query with many long measure names to exceed the URL limit
    const measures = Array.from(
      { length: 200 },
      (_, i) => `VeryLongCubeName${i}.veryLongMeasureNameThatTakesLotsOfCharacters${i}`,
    );
    const query: CubeQuery = { measures };

    const result = buildChatDeeplink(query);

    expect(result.via).toBe('session-storage');
    expect(result.url).toMatch(/^#\/build\?from-chat-artifact=/);
    expect(result.url.length).toBeLessThanOrEqual(8000);
    expect(result.payload).toEqual(query);
    expect(result.artifactId).toBeTruthy();
  });

  it('artifactId is a valid uuid', () => {
    const result = buildChatDeeplink({ measures: ['X.y'] });
    expect(result.artifactId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('session-storage url encodes the artifactId', () => {
    const measures = Array.from({ length: 200 }, (_, i) => `Cube.measure${i}LongName`);
    const result = buildChatDeeplink({ measures });
    if (result.via === 'session-storage') {
      expect(result.url).toContain(encodeURIComponent(result.artifactId));
    }
  });

  it('STORAGE_KEY_PREFIX is exported and has expected shape', () => {
    expect(STORAGE_KEY_PREFIX).toBe('gds-cube:pending-chat-deeplink:');
  });
});
