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
  shortTitle?: string;
  title?: string;
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

/** "mf_users.ltv_total_vnd" → "Ltv total vnd". Last-resort label when meta lacks a title. */
function humaniseMember(memberRef: string): string {
  const leaf = memberRef.includes('.') ? memberRef.slice(memberRef.lastIndexOf('.') + 1) : memberRef;
  const words = leaf.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : memberRef;
}

export type MemberKind = 'measure' | 'dimension' | 'timeDimension';
export type MemberDataType = 'number' | 'string' | 'time';

export interface ResolvedMemberMeta {
  /** Display label — meta shortTitle/title, else humanised member name. */
  label: string;
  dataType: MemberDataType;
  kind: MemberKind;
}

/**
 * Resolve a chart/table column key (a Cube member ref keyed in /load rows) to
 * its display label + data type + kind, from the /meta payload. Used to build
 * the deterministic `columns[]` descriptor so the UI never relies on
 * LLM-invented column names (e.g. "revenue" for ltv_total_vnd).
 *
 * Cube sometimes keys a granular time dimension as "cube.member.granularity"
 * (e.g. ".day"); when an exact match fails we retry on the "cube.member" stem.
 */
export function resolveMemberMeta(meta: any, memberRef: string): ResolvedMemberMeta {
  const candidates = [memberRef];
  const parts = memberRef.split('.');
  if (parts.length >= 3) candidates.push(`${parts[0]}.${parts[1]}`);

  for (const cube of (meta?.cubes as CubeMetaCube[]) ?? []) {
    for (const ref of candidates) {
      const measure = (cube.measures ?? []).find((m) => m.name === ref);
      if (measure) {
        return {
          label: measure.shortTitle ?? measure.title ?? humaniseMember(memberRef),
          dataType: 'number',
          kind: 'measure',
        };
      }
      const dim = (cube.dimensions ?? []).find((d) => d.name === ref);
      if (dim) {
        const isTime = dim.type === 'time';
        return {
          label: dim.shortTitle ?? dim.title ?? humaniseMember(memberRef),
          dataType: isTime ? 'time' : dim.type === 'number' ? 'number' : 'string',
          kind: isTime ? 'timeDimension' : 'dimension',
        };
      }
    }
  }

  // Member not in meta (assistant-derived rollup column, ratio, etc.) — best-effort label.
  return { label: humaniseMember(memberRef), dataType: 'string', kind: 'dimension' };
}
