/**
 * Feature Atlas — shape validator.
 *
 * Hand-rolled (zero deps) so it is importable from BOTH:
 *   - Node ESM tooling  (scripts/atlas-reconcile.mjs)
 *   - the Vite/React app (src/pages/Atlas/atlas-data.ts loads it after js-yaml.parse)
 *
 * A malformed atlas.yaml must fail LOUDLY here, not silently in the renderer.
 * Returns { valid, errors[] } — never throws — so callers decide how to surface.
 */

export const STATUSES = ['idea', 'planned', 'in-flight', 'shipped', 'deprecated'];
export const HEALTHS = ['healthy', 'partial', 'at-risk', 'stale'];
export const EFFORTS = ['S', 'M', 'L', 'XL'];

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Coerce js-yaml timestamp Dates back to ISO YYYY-MM-DD strings.
 * YAML 1.1 auto-parses a bare `2026-06-25` into a Date, but the atlas keeps dates
 * as plain strings so hand-edits need no quoting. Run this right after yaml.load,
 * before validateAtlas, in BOTH the reconcile helper and the in-app loader.
 * @param {any} atlas mutated in place and returned
 */
export function normalizeAtlas(atlas) {
  if (!isPlainObject(atlas)) return atlas;
  const toISO = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
  atlas.reconciledAt = toISO(atlas.reconciledAt);
  for (const surface of atlas.surfaces ?? []) {
    if (!isPlainObject(surface)) continue;
    for (const f of surface.features ?? []) {
      if (isPlainObject(f) && f.lastTouched != null) f.lastTouched = toISO(f.lastTouched);
    }
  }
  return atlas;
}

/**
 * @param {unknown} atlas parsed YAML object
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAtlas(atlas) {
  const errors = [];
  const push = (msg) => errors.push(msg);

  if (!isPlainObject(atlas)) {
    return { valid: false, errors: ['atlas root must be an object'] };
  }
  if (atlas.version !== 1) push(`version must be 1 (got ${JSON.stringify(atlas.version)})`);
  if (typeof atlas.reconciledAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(atlas.reconciledAt)) {
    push(`reconciledAt must be an ISO date string YYYY-MM-DD (got ${JSON.stringify(atlas.reconciledAt)})`);
  }
  if (!Array.isArray(atlas.surfaces)) {
    push('surfaces must be an array');
    return { valid: errors.length === 0, errors };
  }

  const featureIds = new Set();
  const allFeatureIds = new Set();

  // First pass: collect every feature id so deps can be checked against them.
  for (const surface of atlas.surfaces) {
    if (isPlainObject(surface) && Array.isArray(surface.features)) {
      for (const f of surface.features) {
        if (isPlainObject(f) && typeof f.id === 'string') allFeatureIds.add(f.id);
      }
    }
  }

  for (const [si, surface] of atlas.surfaces.entries()) {
    const where = `surfaces[${si}]`;
    if (!isPlainObject(surface)) { push(`${where} must be an object`); continue; }
    if (typeof surface.id !== 'string' || !KEBAB.test(surface.id)) push(`${where}.id must be kebab-case`);
    if (typeof surface.label !== 'string' || !surface.label.trim()) push(`${where}.label is required`);
    if (!Array.isArray(surface.features)) { push(`${where}.features must be an array`); continue; }

    for (const [fi, f] of surface.features.entries()) {
      const fw = `${where}.features[${fi}]`;
      if (!isPlainObject(f)) { push(`${fw} must be an object`); continue; }
      if (typeof f.id !== 'string' || !KEBAB.test(f.id)) {
        push(`${fw}.id must be kebab-case`);
      } else {
        if (featureIds.has(f.id)) push(`duplicate feature id "${f.id}" (must be globally unique)`);
        featureIds.add(f.id);
      }
      if (typeof f.label !== 'string' || !f.label.trim()) push(`${fw}.label is required`);
      if (!STATUSES.includes(f.status)) push(`${fw}.status must be one of ${STATUSES.join('|')} (got ${JSON.stringify(f.status)})`);
      if (!HEALTHS.includes(f.health)) push(`${fw}.health must be one of ${HEALTHS.join('|')} (got ${JSON.stringify(f.health)})`);
      if (f.summary != null && typeof f.summary !== 'string') push(`${fw}.summary must be a string`);

      if (f.drawbacks != null) {
        if (!Array.isArray(f.drawbacks)) push(`${fw}.drawbacks must be an array`);
        else f.drawbacks.forEach((d, i) => { if (typeof d !== 'string') push(`${fw}.drawbacks[${i}] must be a string`); });
      }

      if (f.directions != null) {
        if (!Array.isArray(f.directions)) push(`${fw}.directions must be an array`);
        else f.directions.forEach((d, i) => {
          const dw = `${fw}.directions[${i}]`;
          if (!isPlainObject(d)) { push(`${dw} must be an object {label, effort}`); return; }
          if (typeof d.label !== 'string' || !d.label.trim()) push(`${dw}.label is required`);
          if (d.effort != null && !EFFORTS.includes(d.effort)) push(`${dw}.effort must be one of ${EFFORTS.join('|')}`);
        });
      }

      if (f.deps != null) {
        if (!Array.isArray(f.deps)) push(`${fw}.deps must be an array`);
        else f.deps.forEach((dep, i) => {
          if (typeof dep !== 'string') { push(`${fw}.deps[${i}] must be a feature id string`); return; }
          if (!allFeatureIds.has(dep)) push(`${fw}.deps[${i}] "${dep}" references an unknown feature id`);
        });
      }

      if (f.links != null) {
        if (!isPlainObject(f.links)) push(`${fw}.links must be an object`);
        else for (const key of ['plans', 'code', 'memory']) {
          if (f.links[key] != null && !Array.isArray(f.links[key])) push(`${fw}.links.${key} must be an array`);
        }
      }

      if (f.lastTouched != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(f.lastTouched))) {
        push(`${fw}.lastTouched must be an ISO date YYYY-MM-DD`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
