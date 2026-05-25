/**
 * Capability probes over a cube /meta payload.
 *
 * Used by the disambiguator to refuse measure × timeRange combinations that
 * cube cannot honour. A "snapshot" cube has measures but no `type: 'time'`
 * dimension — querying it with a timeRange would either be ignored by Cube
 * or produce a misleading lifetime aggregate the user didn't ask for.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CubeDimension {
  name: string;
  type?: string;
}

interface CubeMeasure {
  name: string;
  type?: string;
  shortTitle?: string;
  title?: string;
}

interface CubeMetaCube {
  name: string;
  measures?: CubeMeasure[];
  dimensions?: CubeDimension[];
}

function getCubeByName(meta: any, cubeName: string): CubeMetaCube | undefined {
  const cubes: CubeMetaCube[] = meta?.cubes ?? [];
  return cubes.find((c) => c.name === cubeName);
}

/** Strip "cube.member" → "cube". Returns null if the ref isn't dot-shaped. */
export function cubeNameOf(memberRef: string): string | null {
  const idx = memberRef.indexOf('.');
  return idx > 0 ? memberRef.slice(0, idx) : null;
}

/**
 * True when the cube exposes at least one dimension of type 'time' — the
 * only shape Cube treats as the anchor for a timeRange / dateRange filter.
 */
export function cubeHasTimeDimension(meta: any, cubeName: string): boolean {
  const cube = getCubeByName(meta, cubeName);
  if (!cube) return false;
  return (cube.dimensions ?? []).some((d) => d.type === 'time');
}

/** All time-typed dimension refs across the whole meta payload. */
export function listTimeDimensions(meta: any): string[] {
  const out: string[] = [];
  for (const cube of (meta?.cubes as CubeMetaCube[]) ?? []) {
    for (const d of cube.dimensions ?? []) {
      if (d.type === 'time') out.push(d.name);
    }
  }
  return out;
}

/** Pick a single canonical time dimension for `cubeName`, or null. */
export function primaryTimeDimensionOf(meta: any, cubeName: string): string | null {
  const cube = getCubeByName(meta, cubeName);
  if (!cube) return null;
  const td = (cube.dimensions ?? []).find((d) => d.type === 'time');
  return td?.name ?? null;
}
