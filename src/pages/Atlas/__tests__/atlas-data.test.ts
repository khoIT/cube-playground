import { describe, it, expect } from 'vitest';
import { loadAtlas } from '../atlas-data';

/**
 * End-to-end load smoke test. Because vitest runs through Vite's transform
 * pipeline, this exercises the real `atlas.yaml?raw` import + js-yaml parse +
 * normalize + validate + shape path the app uses at runtime.
 */
describe('loadAtlas (real atlas.yaml via ?raw)', () => {
  const result = loadAtlas();

  it('loads and validates the committed atlas', () => {
    expect(result.ok).toBe(true);
  });

  it('has the 6 agreed surfaces and a populated feature set', () => {
    if (!result.ok) throw new Error('error' in result ? result.error : 'load failed');
    expect(result.model.surfaces).toHaveLength(6);
    const total = result.model.surfaces.reduce((n, s) => n + s.features.length, 0);
    expect(total).toBeGreaterThanOrEqual(50);
    expect(result.model.featById.size).toBe(total);
  });

  it('normalizes directions (no leaked junk keys) and resolves the reverse-dep index', () => {
    if (!result.ok) throw new Error('error' in result ? result.error : 'load failed');
    const all = result.model.surfaces.flatMap((s) => s.features);
    // Every direction is exactly {label, effort} — the comma-trap guard held.
    for (const f of all) {
      for (const d of f.directions) {
        expect(typeof d.label).toBe('string');
        expect(d.label.length).toBeGreaterThan(0);
        expect(d.effort === null || ['S', 'M', 'L', 'XL'].includes(d.effort)).toBe(true);
      }
    }
    // A known dep edge resolves into the reverse index (cs-ticket-join is depended on).
    expect((result.model.dependedOnBy.get('cs-ticket-join') ?? []).length).toBeGreaterThan(0);
  });

  it('every modeled dep points at a real feature id', () => {
    if (!result.ok) throw new Error('error' in result ? result.error : 'load failed');
    const all = result.model.surfaces.flatMap((s) => s.features);
    for (const f of all) {
      for (const dep of f.deps) {
        // deps in the seed are all modeled; if one isn't, surface it loudly.
        expect(result.model.featById.has(dep)).toBe(true);
      }
    }
  });
});
