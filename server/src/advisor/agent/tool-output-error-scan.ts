/**
 * Detects a SEMANTIC error embedded in a tool output that otherwise returned
 * cleanly (state='ok'). The advisor's deterministic tools (diagnose, recommend,
 * the lenses) catch a failed Cube query and fold it INTO their JSON result as an
 * inconclusive verdict — so the SDK sees a successful tool_result while the real
 * work failed. The ok/failed state alone hides that; this scan surfaces it.
 *
 * Lives in the agent dir → scanned by the no-PII surface guard. It only reads an
 * already-redacted output digest (aggregates + member-resolver IDs), never raw
 * member rows, and returns a short bounded message.
 */

/** Max length of the extracted message kept on the audit row. */
const MAX_MESSAGE = 300;

/**
 * Signatures of a real failure embedded in an ok output. Deliberately narrow:
 * an empty result set (e.g. `"candidates":[]`) is NOT an error — only explicit
 * upstream/query failures are flagged.
 */
const ERROR_SIGNATURES: RegExp[] = [
  /"type"\s*:\s*"UserError"/, // Cube /load UserError envelope
  /not found for path/i, // member/measure resolution failure
  /Cube\s*\/load\s*→\s*[45]\d\d/, // Cube HTTP 4xx/5xx
  /→\s*(?:400|401|403|404|409|429|500|502|503|504)\b/, // generic upstream HTTP error
  /"verdict"\s*:\s*"inconclusive"[\s\S]{0,80}?(?:error|→\s*[45]\d\d|not found)/i,
];

/** Pull the most informative human message out of the digest, bounded. */
function extractMessage(text: string): string {
  // Prefer the Cube error string: {"error":"<msg>"}.
  const err = text.match(/"error"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (err?.[1]) return clamp(unescapeJson(err[1]));
  // Else the inconclusive reason field.
  const reason = text.match(/"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (reason?.[1]) return clamp(unescapeJson(reason[1]));
  // Else a short window around "not found for path".
  const nf = text.match(/.{0,40}not found for path.{0,60}/i);
  if (nf?.[0]) return clamp(nf[0]);
  return 'embedded error in tool output';
}

function unescapeJson(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function clamp(s: string): string {
  const t = s.trim();
  return t.length > MAX_MESSAGE ? `${t.slice(0, MAX_MESSAGE)}…` : t;
}

/**
 * @returns a short message when the digest embeds a failure, else null.
 */
export function scanToolOutputForError(outputDigest: string | undefined | null): string | null {
  if (!outputDigest) return null;
  for (const sig of ERROR_SIGNATURES) {
    if (sig.test(outputDigest)) return extractMessage(outputDigest);
  }
  return null;
}
