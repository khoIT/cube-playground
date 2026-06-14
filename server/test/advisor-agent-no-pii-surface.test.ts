/**
 * No-PII surface guard — a cross-cutting regression tripwire.
 *
 * The advisor agent must reason on aggregates + the minimal identity allowlist
 * (user_id + numeric + reachability). It must NEVER request or expose contact
 * PII. This test statically asserts the *data-bearing* agent surfaces — the
 * system prompt, the context pack, and every tool definition — contain no PII
 * column tokens. The redaction/inbound guards legitimately NAME these tokens
 * (to strip them) and the audit log references the operator's own email, so
 * they are excluded; a leak would instead show up where the agent decides what
 * to fetch or say, which is exactly what is scanned here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const agentDir = join(here, '..', 'src', 'advisor', 'agent');

/**
 * Concrete PII column-name tokens that would only appear if a surface actually
 * fetched/exposed them. Deliberately excludes generic words like "contact" and
 * "address" — those legitimately appear in DENY-instructions ("never request
 * contact columns") and in "addressable", which a token grep cannot tell apart
 * from a leak. A real leak surfaces as a concrete column name below.
 */
const PII_TOKENS = [
  'email',
  'phone',
  'msisdn',
  'passport',
  'national_id',
  'zalo_id',
  'vga_id',
  'ingame_name',
  'full_name',
  'device_id',
  'ip_address',
];

/** Files that legitimately name PII tokens (to block/redact) → excluded. */
const ALLOWED_TO_NAME_PII = new Set([
  'agent-redaction-guard.ts',
  'agent-inbound-guard.ts',
  'agent-audit-log.ts', // operator email only, not player PII
]);

/**
 * External data the context pack INLINES verbatim into the system prompt — so a
 * PII token here would ship to the model just as surely as one in the prompt
 * file itself. `agent-context-pack.ts` embeds the playbook registry's fields.
 */
const INLINED_PROMPT_DATA = [join(agentDir, '..', '..', 'care', 'playbook-registry.ts')];

function dataBaringSurfaceFiles(): string[] {
  const top = readdirSync(agentDir)
    .filter((f) => f.endsWith('.ts') && !ALLOWED_TO_NAME_PII.has(f))
    .map((f) => join(agentDir, f));
  const tools = readdirSync(join(agentDir, 'tools'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(agentDir, 'tools', f));
  return [...top, ...tools, ...INLINED_PROMPT_DATA];
}

describe('no-PII surface guard', () => {
  it('scans a non-trivial set of agent files', () => {
    expect(dataBaringSurfaceFiles().length).toBeGreaterThan(8);
  });

  it('no data-bearing agent surface references a contact/PII column token', () => {
    const offenders: { file: string; token: string; line: number }[] = [];
    for (const file of dataBaringSurfaceFiles()) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const lower = line.toLowerCase();
        for (const token of PII_TOKENS) {
          // word-ish boundary so "iphone"/"telephone" style false hits stay out,
          // and so "email" inside a URL/word doesn't trip — require the token to
          // stand as an identifier fragment.
          const re = new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`);
          if (re.test(lower)) offenders.push({ file: file.replace(agentDir, ''), token, line: i + 1 });
        }
      });
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
