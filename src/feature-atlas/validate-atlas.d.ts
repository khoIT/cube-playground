/**
 * Types for the hand-rolled JS validator (validate-atlas.mjs), shared between the
 * Node reconcile helper and the in-app loader (src/pages/Atlas/atlas-data.ts).
 */
export const STATUSES: string[];
export const HEALTHS: string[];
export const EFFORTS: string[];

export function validateAtlas(atlas: unknown): { valid: boolean; errors: string[] };

/** Coerces js-yaml timestamp Dates back to ISO YYYY-MM-DD strings; mutates + returns. */
export function normalizeAtlas<T>(atlas: T): T;
