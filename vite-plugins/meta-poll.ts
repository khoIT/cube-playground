/**
 * meta-poll.ts
 * Polls the Cube /meta endpoint until the specified measure appears,
 * resolving with the full meta payload on success or rejecting on timeout.
 */

export interface PollOptions {
  /** Total time in ms before giving up. Default: 5000 */
  timeoutMs?: number;
  /** Interval between polls in ms. Default: 200 */
  intervalMs?: number;
  /** Bearer token for Cube API auth; omit if not required. */
  token?: string;
}

export interface CubeMeta {
  cubes: CubeDefinition[];
}

interface CubeDefinition {
  name: string;
  measures: MemberDefinition[];
  dimensions?: MemberDefinition[];
}

interface MemberDefinition {
  name: string;
  [key: string]: unknown;
}

/**
 * Polls `<cubeApiUrl>/meta` at `intervalMs` cadence until the measure
 * `<cubeName>.<measureName>` appears, or until `timeoutMs` elapses.
 *
 * @param cubeApiUrl  Base Cube REST API URL, e.g. "http://localhost:4000/cubejs-api/v1"
 * @param cubeName    Cube name (matches the cube's `name` field in /meta)
 * @param measureName Bare measure name without cube prefix
 * @param options     Timing + auth options
 * @returns           The full CubeMeta payload once the measure is visible
 */
export async function waitForMember(
  cubeApiUrl: string,
  cubeName: string,
  measureName: string,
  options: PollOptions = {},
): Promise<CubeMeta> {
  const { timeoutMs = 5000, intervalMs = 200, token } = options;

  const metaUrl = `${cubeApiUrl.replace(/\/$/, '')}/meta`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // The measure name in /meta responses is qualified: "CubeName.measureName"
  const qualifiedName = `${cubeName}.${measureName}`;

  const deadline = Date.now() + timeoutMs;

  async function attempt(): Promise<CubeMeta> {
    const now = Date.now();
    if (now >= deadline) {
      throw new Error(
        `meta-poll timeout after ${timeoutMs}ms: "${qualifiedName}" not found in /meta`,
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
    const found = cube?.measures.some((m) => m.name === qualifiedName) ?? false;

    if (found) {
      return meta;
    }

    if (Date.now() + intervalMs >= deadline) {
      throw new Error(
        `meta-poll timeout after ${timeoutMs}ms: "${qualifiedName}" not yet in /meta`,
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
