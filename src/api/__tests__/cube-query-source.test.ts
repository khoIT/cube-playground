/**
 * Unit tests for cube-query-source: route → machine source string, and the
 * machine string → human label used by the Query Performance admin UI.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { deriveCubeSource, humanizeCubeSource } from '../cube-query-source';

function at(path: string) {
  window.history.pushState({}, '', path);
}

afterEach(() => at('/'));

// The app runs under HashRouter — real routes look like `localhost/#/segments/45`.
// These cover the production shape (route in the hash, not the pathname).
describe('deriveCubeSource (HashRouter)', () => {
  it('maps the query builder route', () => {
    at('/#/build');
    expect(deriveCubeSource()).toBe('query-builder');
  });
  it('maps a dashboard to dashboard:<id>', () => {
    at('/#/dashboards/123');
    expect(deriveCubeSource()).toBe('dashboard:123');
  });
  it('maps a segment + ?tab (inside the hash) to segment:<id>:<tab>', () => {
    at('/#/segments/45?tab=care');
    expect(deriveCubeSource()).toBe('segment:45:care');
  });
  it('maps a segment without a tab', () => {
    at('/#/segments/45');
    expect(deriveCubeSource()).toBe('segment:45');
  });
  it('maps explore + catalog', () => {
    at('/#/explore');
    expect(deriveCubeSource()).toBe('explore');
    at('/#/catalog/metric/dau');
    expect(deriveCubeSource()).toBe('catalog:metric/dau');
  });
  it('falls back to the joined path for unknown routes', () => {
    at('/#/liveops/cohort');
    expect(deriveCubeSource()).toBe('liveops/cohort');
  });
});

// Non-hash deployments still resolve via the pathname fallback.
describe('deriveCubeSource (pathname fallback)', () => {
  it('maps the query builder route from the pathname', () => {
    at('/build');
    expect(deriveCubeSource()).toBe('query-builder');
  });
  it('maps a segment + ?tab from the pathname', () => {
    at('/segments/45?tab=care');
    expect(deriveCubeSource()).toBe('segment:45:care');
  });
});

describe('humanizeCubeSource', () => {
  it('renders each source class', () => {
    expect(humanizeCubeSource(null)).toBe('API / server');
    expect(humanizeCubeSource('query-builder')).toBe('Query Builder');
    expect(humanizeCubeSource('explore')).toBe('Explore');
    expect(humanizeCubeSource('dashboard:123')).toBe('Dashboard #123');
    expect(humanizeCubeSource('segment:b92b61ff-30a8-44b0')).toBe('Segment #b92b61ff');
    expect(humanizeCubeSource('segment:b92b61ff-30a8:care')).toBe('Segment #b92b61ff · Care');
    // With a resolved name, the UUID is replaced by the segment's display name.
    expect(humanizeCubeSource('segment:b92b61ff-30a8', 'High-Value Spenders')).toBe('High-Value Spenders');
    expect(humanizeCubeSource('segment:b92b61ff-30a8:members', 'High-Value Spenders')).toBe('High-Value Spenders · Members');
    expect(humanizeCubeSource('chat:abcd1234efgh')).toBe('Chat · abcd1234');
    expect(humanizeCubeSource('chat')).toBe('Chat');
    expect(humanizeCubeSource('catalog:metric/dau')).toBe('Catalog');
    expect(humanizeCubeSource('liveops/cohort')).toBe('Liveops');
  });
  it('normalizes legacy Referer-path values (leading/trailing slashes)', () => {
    // Rows captured before the client tagged requests stored a raw pathname.
    expect(humanizeCubeSource('/build')).toBe('Query Builder');
    expect(humanizeCubeSource('//')).toBe('API / server');
    expect(humanizeCubeSource('/liveops/cohort')).toBe('Liveops');
  });
});
