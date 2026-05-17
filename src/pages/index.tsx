import { loadable } from '../loadable';

// Lazy-loaded route components. Each is its own chunk so the cold-start
// bundle does not parse Catalog/Schema/Metric-card code on a Playground
// boot. `loadable()` wraps `React.lazy` with chunk-load retry handling.
//
// IMPORTANT — H3 (red team): `export *` would cause Vite to eagerly resolve
// the underlying modules into the initial chunk and silently defeat lazy
// splitting. Every route component is mapped explicitly through `loadable`.

export const SchemaPage = loadable(() =>
  import('./Schema/SchemaPage').then((m) => ({ default: m.SchemaPage }))
);

export const ExplorePage = loadable(() =>
  import('./Explore/ExplorePage').then((m) => ({ default: m.ExplorePage }))
);

export const IndexPage = loadable(() =>
  import('./Index/IndexPage').then((m) => ({ default: m.IndexPage }))
);

export const CatalogPage = loadable(() =>
  import('./Catalog/catalog-page').then((m) => ({ default: m.CatalogPage }))
);

export const MetricCardPage = loadable(() =>
  import('./Catalog/metric-card-page').then((m) => ({
    default: m.MetricCardPage,
  }))
);
