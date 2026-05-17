import { describe, it, expect } from 'vitest';

import {
  CatalogPage,
  ExplorePage,
  IndexPage,
  MetricCardPage,
  SchemaPage,
} from '../index';

// H3 (red team): the page barrel used to do `export * from './X'` which
// causes Vite to inline those modules into the initial chunk and silently
// defeats `React.lazy()`. After the rewrite, every exported route is wrapped
// with the `loadable()` helper. The helper attaches `.load` and `.loaded`
// fields that are observable from outside, which makes "is this lazy?" a
// falsifiable assertion.

describe('pages barrel — lazy structure (H3)', () => {
  it('every routed page component is wrapped with loadable()', () => {
    for (const Component of [
      IndexPage,
      ExplorePage,
      CatalogPage,
      MetricCardPage,
      SchemaPage,
    ]) {
      // `loadable()` mutates the lazy component with these fields.
      expect((Component as any).load).toBeTypeOf('function');
      expect((Component as any).loaded).toBe(false);
    }
  });

  it('barrel export does not eagerly evaluate the underlying chunks', () => {
    // Pre-rewrite the barrel used `export *` which means importing the
    // barrel inlined every page module. After the rewrite, every page is
    // a lazy wrapper whose `.loaded` flag is `false` until a render forces
    // resolution. This test runs at module-import time so observing all five
    // flags as `false` is the falsifiable proof that the chunks have not
    // been touched yet.
    expect((IndexPage as any).loaded).toBe(false);
    expect((ExplorePage as any).loaded).toBe(false);
    expect((CatalogPage as any).loaded).toBe(false);
    expect((MetricCardPage as any).loaded).toBe(false);
    expect((SchemaPage as any).loaded).toBe(false);
  });
});
