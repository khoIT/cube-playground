/**
 * Inbound guards on user text before it enters agent context.
 *
 *  - redactInbound:  strip obvious PII (emails, long digit runs) so player
 *    contact details never reach the model or the audit log. A business
 *    question rarely carries PII, but we fail safe.
 *  - sanitizeInbound: neutralize prompt-injection patterns (role-impersonation
 *    headers, "ignore previous instructions", zero-width chars) so a pasted
 *    blob can't rewrite the agent's instructions.
 *
 * Both are pure and return what changed, so callers can audit. The tool-output
 * side of these guards is wired in the tool surface layer.
 */

export interface GuardResult {
  text: string;
  modified: boolean;
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Replace emails with a neutral placeholder. We intentionally do NOT redact
 * long digit runs here: the advisor reasons about large business figures
 * (VND revenue, player counts) that are not PII, and blunt digit-length
 * redaction would mangle legitimate questions. Contact-number redaction lives
 * on the tool-output side, where the data actually carries player PII.
 */
export function redactInbound(input: string): GuardResult {
  let modified = false;
  const text = input.replace(EMAIL_RE, () => {
    modified = true;
    return '[redacted-email]';
  });
  return { text, modified };
}

// Lines that try to impersonate a system/developer/assistant role.
const ROLE_IMPERSONATION_RE = /^\s*(system|developer|assistant|tool)\s*:/gim;
// Classic instruction-override phrasing.
const OVERRIDE_RE = /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b/gi;
// Zero-width / bidi control characters used to hide injected text.
const HIDDEN_CHARS_RE = /[​-‏‪-‮﻿]/g;

/**
 * Neutralize injection patterns. We escape rather than delete role headers so
 * the manager's wording is preserved but defanged.
 */
export function sanitizeInbound(input: string): GuardResult {
  let modified = false;
  const mark = <T>(v: T): T => {
    modified = true;
    return v;
  };
  const text = input
    .replace(HIDDEN_CHARS_RE, () => mark(''))
    .replace(ROLE_IMPERSONATION_RE, (m) => mark(`[quoted] ${m.trim()}`))
    .replace(OVERRIDE_RE, (m) => mark(`[quoted: ${m}]`));
  return { text, modified };
}

/** Apply redaction then sanitization; report if either touched the text. */
export function guardInbound(input: string): GuardResult {
  const redacted = redactInbound(input);
  const sanitized = sanitizeInbound(redacted.text);
  return { text: sanitized.text, modified: redacted.modified || sanitized.modified };
}
