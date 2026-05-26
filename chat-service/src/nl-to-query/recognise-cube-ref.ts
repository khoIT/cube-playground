/**
 * Recognise a fully-qualified cube reference inside a user message.
 *
 * Phase 02a — when a user types `recharge.revenue_vnd` we should never round-
 * trip them through clarification. The token IS the answer; the resolver
 * just needs to confirm the member exists in `get_cube_meta`. Skips the
 * usual synonym ranking entirely.
 *
 * The recogniser is intentionally narrow: a single token matching
 * `cube.member`, lowercase + underscores. Phrases that contain a ref alongside
 * other words ("the recharge.revenue_vnd of VN players") still fire, since the
 * scanner walks tokens — we extract the ref and ignore the surrounding text
 * for ref resolution; intent classification continues to run.
 */

const REF_RE = /\b([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\b/g;

export interface CubeRefHit {
  cubeRef: string;
  cube: string;
  member: string;
  span: [number, number];
}

/**
 * Scan a message for fully-qualified cube references. Each hit is validated
 * against `knownMembers` (the set surfaced by `get_cube_meta`); refs that
 * don't resolve are dropped so the resolver doesn't pin a typo.
 *
 * Returns confidence-1.0 hits — exact lexical match + meta validation is as
 * deterministic as the engine gets.
 */
export function recogniseCubeRefs(
  message: string,
  knownMembers?: Set<string>,
): CubeRefHit[] {
  const out: CubeRefHit[] = [];
  if (!message) return out;

  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(message)) !== null) {
    const [full, cube, member] = m;
    if (!cube || !member) continue;
    if (knownMembers && !knownMembers.has(full)) continue;
    out.push({
      cubeRef: full,
      cube,
      member,
      span: [m.index, m.index + full.length],
    });
  }
  return out;
}

/**
 * Convenience: pick the first valid ref in the message (most messages carry
 * at most one). When `knownMembers` is undefined, the caller is acknowledging
 * cube-meta wasn't loaded — we still recognise the lexical shape but mark
 * confidence lower so the caller can decide what to do.
 */
export function firstCubeRef(
  message: string,
  knownMembers?: Set<string>,
): { hit: CubeRefHit; confidence: number } | null {
  const hits = recogniseCubeRefs(message, knownMembers);
  if (hits.length === 0) return null;
  return { hit: hits[0]!, confidence: knownMembers ? 1.0 : 0.7 };
}
