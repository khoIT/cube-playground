/**
 * Anthropic gateway key failover — rotates to ANTHROPIC_API_STG_KEY /
 * ANTHROPIC_API_BACKUP_KEY when the active key's balance is exhausted.
 *
 * The LLM gateway (LiteLLM) surfaces a drained key as an HTTP 400 whose body
 * carries Anthropic's "Your credit balance is too low to access the Anthropic
 * API", or as LiteLLM's own per-key budget error ("ExceededBudget" / "Budget
 * has been exceeded"). On either signal the caller reports the key exhausted
 * and we hand out the next key in priority order: primary → stg → backup.
 *
 * Exhausted marks expire after a cooldown (default 10 min) so a topped-up
 * higher-priority key is retried automatically — no restart needed. When every
 * key is exhausted we still return the least-recently-failed one (callers must
 * always get a key; the resulting error stays classifiable upstream).
 *
 * State is process-local and intentionally simple — a single chat-service
 * instance owns its key choice. No persistence: a restart re-probes primary.
 */

import { config } from '../config.js';

export type AnthropicKeyLabel = 'primary' | 'stg' | 'backup';

export interface ActiveAnthropicKey {
  key: string;
  label: AnthropicKeyLabel;
}

interface KeySlot {
  label: AnthropicKeyLabel;
  key: string;
  /** Epoch ms of the last balance-exhausted report; undefined = healthy. */
  exhaustedAt?: number;
}

const DEFAULT_RETRY_COOLDOWN_MS = 10 * 60 * 1000;

/** Lowercased substrings that identify a balance/budget exhaustion failure.
 *  Anthropic upstream: "Your credit balance is too low to access the Anthropic
 *  API" (verified live against the gateway). LiteLLM per-key budgets:
 *  "ExceededBudget", "Budget has been exceeded". */
const BALANCE_EXHAUSTED_SIGNALS = [
  'credit balance is too low',
  'balance is too low',
  'insufficient credit',
  'insufficient balance',
  'exceededbudget',
  'exceeded budget',
  'budget has been exceeded',
  'out of credits',
];

/** True when the failure text indicates the key's balance/budget is drained. */
export function isBalanceExhaustedError(message: string | null | undefined): boolean {
  if (!message) return false;
  const h = message.toLowerCase();
  return BALANCE_EXHAUSTED_SIGNALS.some((s) => h.includes(s));
}

// Lazily built so test mocks of config.js are honoured per-suite.
let slots: KeySlot[] | null = null;

function buildSlots(): KeySlot[] {
  const out: KeySlot[] = [];
  if (config.anthropicApiKey) out.push({ label: 'primary', key: config.anthropicApiKey });
  if (config.anthropicApiStgKey) out.push({ label: 'stg', key: config.anthropicApiStgKey });
  if (config.anthropicApiBackupKey) out.push({ label: 'backup', key: config.anthropicApiBackupKey });
  return out;
}

function getSlots(): KeySlot[] {
  if (!slots) slots = buildSlots();
  return slots;
}

function cooldownMs(): number {
  return config.anthropicKeyRetryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS;
}

/** Number of configured keys — the upper bound on per-turn retry attempts. */
export function anthropicKeyCount(): number {
  return getSlots().length;
}

/**
 * The key the next LLM call should use: the highest-priority key whose
 * exhausted mark is absent or has cooled down. All exhausted → the
 * least-recently-failed one (a key must always be returned).
 */
export function getActiveAnthropicKey(): ActiveAnthropicKey {
  const all = getSlots();
  if (all.length === 0) {
    // config.ts requires ANTHROPIC_API_KEY, so this only fires under broken
    // test mocks — fail loud rather than sending an empty key to the gateway.
    throw new Error('No Anthropic API keys configured');
  }
  const now = Date.now();
  const healthy = all.find(
    (s) => s.exhaustedAt === undefined || now - s.exhaustedAt > cooldownMs(),
  );
  if (healthy) return { key: healthy.key, label: healthy.label };
  const leastRecent = all.reduce((a, b) =>
    (a.exhaustedAt ?? 0) <= (b.exhaustedAt ?? 0) ? a : b,
  );
  return { key: leastRecent.key, label: leastRecent.label };
}

export interface KeyRotationResult {
  /** True when another (non-exhausted) key is available to retry with. */
  rotated: boolean;
  /** Label of the key the next getActiveAnthropicKey() call will hand out. */
  nextLabel?: AnthropicKeyLabel;
}

/**
 * Mark `usedKey` balance-exhausted and report whether a different key is now
 * available. Keyed by the actual key string (not label) so a stale caller that
 * raced a rotation can't knock out the freshly promoted key.
 */
export function reportKeyBalanceExhausted(usedKey: string): KeyRotationResult {
  const all = getSlots();
  const slot = all.find((s) => s.key === usedKey);
  if (!slot) return { rotated: false };
  slot.exhaustedAt = Date.now();
  // Rotation only counts when a genuinely healthy key remains — when every
  // key is drained, getActiveAnthropicKey() still hands out the least-recently
  // failed one, but retrying it immediately is futile; report no rotation so
  // callers surface the error instead of burning attempts.
  const now = Date.now();
  const healthy = all.find(
    (s) => s.exhaustedAt === undefined || now - s.exhaustedAt > cooldownMs(),
  );
  if (!healthy || healthy.key === usedKey) return { rotated: false };
  console.warn(
    `[key-failover] Anthropic key '${slot.label}' balance exhausted — switching to '${healthy.label}'`,
  );
  return { rotated: true, nextLabel: healthy.label };
}

/** Ops snapshot for /health — labels only, never key material. */
export function keyFailoverStatus(): {
  active: AnthropicKeyLabel;
  configured: AnthropicKeyLabel[];
  exhausted: AnthropicKeyLabel[];
} {
  const all = getSlots();
  const now = Date.now();
  return {
    active: getActiveAnthropicKey().label,
    configured: all.map((s) => s.label),
    exhausted: all
      .filter((s) => s.exhaustedAt !== undefined && now - s.exhaustedAt <= cooldownMs())
      .map((s) => s.label),
  };
}

/** Reset module state — exposed for tests. */
export function __resetKeyFailoverForTests(): void {
  slots = null;
}
