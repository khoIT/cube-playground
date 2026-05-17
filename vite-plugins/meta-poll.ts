/**
 * meta-poll.ts
 * Polls the Cube /meta endpoint until the specified entry (measure, dimension,
 * or segment) appears in its kind-specific section, resolving with the full
 * meta payload on success or rejecting on timeout.
 *
 * Contract: this function THROWS on timeout (not returns null). Handler-level
 * code catches the throw and translates it into `200 + warning: 'meta-not-acknowledged'`.
 */

export type EntryKind = 'measure' | 'dimension' | 'segment';

export interface PollOptions {
  /** Total time in ms before giving up. Default: 5000 */
  timeoutMs?: number;
  /** Interval between polls in ms. Default: 200 */
  intervalMs?: number;
  /** Bearer token for Cube API auth; omit if not required. */
  token?: string;
  /** Section of /meta to inspect. Default: 'measure' (back-compat). */
  kind?: EntryKind;
}

export interface CubeMeta {
  cubes: CubeDefinition[];
}

interface CubeDefinition {
  name: string;
  measures?: MemberDefinition[];
  dimensions?: MemberDefinition[];
  segments?: MemberDefinition[];
}

interface MemberDefinition {
  name: string;
  [key: string]: unknown;
}

const SECTION_FOR_KIND: Record<EntryKind, 'measures' | 'dimensions' | 'segments'> = {
  measure: 'measures',
  dimension: 'dimensions',
  segment: 'segments',
};

/**
 * Polls `<cubeApiUrl>/meta` at `intervalMs` cadence until the entry
 * `<cubeName>.<entryName>` appears in the section keyed by `kind`, or until
 * `timeoutMs` elapses.
 *
 * @param cubeApiUrl  Base Cube REST API URL, e.g. "http://localhost:4000/cubejs-api/v1"
 * @param cubeName    Cube name (matches the cube's `name` field in /meta)
 * @param entryName   Bare entry name without cube prefix
 * @param options     Timing + auth options + kind (defaults 'measure')
 * @returns           The full CubeMeta payload once the entry is visible
 */
export async function waitForMember(
  cubeApiUrl: string,
  cubeName: string,
  entryName: string,
  options: PollOptions = {},
): Promise<CubeMeta> {
  const { timeoutMs = 5000, intervalMs = 200, token, kind = 'measure' } = options;
  const sectionKey = SECTION_FOR_KIND[kind];

  const metaUrl = `${cubeApiUrl.replace(/\/$/, '')}/meta`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // The entry name in /meta responses is qualified: "CubeName.entryName"
  const qualifiedName = `${cubeName}.${entryName}`;

  const deadline = Date.now() + timeoutMs;

  async function attempt(): Promise<CubeMeta> {
    const now = Date.now();
    if (now >= deadline) {
      throw new Error(
        `meta-poll timeout after ${timeoutMs}ms: "${qualifiedName}" (${kind}) not found in /meta`,
      );
    }

    let meta: CubeMeta;
    try {
      const res = await fetch(metaUrl, { headers });
      if (!res.ok) {
        throw new Error(`/meta returned HTTP ${res.status}`);
      }
      meta = (await res.json()) as CubeMeta;
    } catch (err) {
      // Network or parse error — wait and retry if time remains.
      if (Date.now() + intervalMs >= deadline) {
        throw new Error(
          `meta-poll timeout after ${timeoutMs}ms: last error: ${String(err)}`,
        );
      }
      await sleep(intervalMs);
      return attempt();
    }

    const cube = meta.cubes.find((c) => c.name === cubeName);
    // Defensive: cubes without the relevant section (e.g. a dim-less cube)
    // return undefined for that key — `?? []` keeps the `.some()` call safe.
    const section = (cube as Record<string, unknown> | undefined)?.[sectionKey] as
      | MemberDefinition[]
      | undefined;
    const found = (section ?? []).some((m) => m.name === qualifiedName);

    if (found) {
      return meta;
    }

    if (Date.now() + intervalMs >= deadline) {
      throw new Error(
        `meta-poll timeout after ${timeoutMs}ms: "${qualifiedName}" (${kind}) not yet in /meta`,
      );
    }

    await sleep(intervalMs);
    return attempt();
  }

  return attempt();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
