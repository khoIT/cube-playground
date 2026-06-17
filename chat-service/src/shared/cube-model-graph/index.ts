/**
 * Shared cube-model-graph barrel.
 *
 * `build-join-graph.ts` is a byte-identical vendored copy of the FE Catalog
 * builder at `src/pages/Catalog/cube-graph/build-join-graph.ts`. The two copies
 * exist because chat-service builds and ships standalone (its Docker image has
 * no FE source), so a single cross-package import is impossible. A drift-guard
 * test (`test/cube-model-graph-drift.test.ts`) fails loudly if the copies
 * diverge — the deterministic "no drift" enforcement the plan calls for.
 */
export * from './build-join-graph.js';
