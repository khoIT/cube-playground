/**
 * Anthropic gateway key failover — rotates to ANTHROPIC_API_STG_KEY /
 * ANTHROPIC_API_BACKUP_KEY when the active key's balance is exhausted, and
 * finally to a Claude subscription OAuth token (ANTHROPIC_SUBSCRIPTION_OAUTH_TOKEN)
 * as the last-resort rung: primary → stg → backup → subscription.
 *
 * The LLM gateway (LiteLLM) surfaces a drained key as an HTTP 400 whose body
 * carries Anthropic's "Your credit balance is too low to access the Anthropic
 * API", or as LiteLLM's own per-key budget error ("ExceededBudget" / "Budget
 * has been exceeded"). On either signal the caller reports the key exhausted
 * and we hand out the next slot in priority order.
 *
 * The subscription slot authenticates differently: instead of an API key sent
 * to the gateway, the SDK subprocess gets CLAUDE_CODE_OAUTH_TOKEN (a long-lived
 * token from `claude setup-token`) and NO base-url override, so it talks
 * directly to api.anthropic.com on the subscription quota. Its exhaustion
 * signal is the 5-hour usage-window error ("usage limit reached"), matched by
 * the same classifier. Use anthropicAuthEnvFor() to build the right env bag.
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
import { getLlmAuthMode, type LlmAuthMode } from './llm-auth-mode.js';

export type AnthropicKeyLabel =
  | 'primary'
  | 'stg'
  | 'backup'
  | 'subscription'
  | 'subscription-vy'
  | 'subscription-thi';

/** How the slot's secret authenticates the SDK subprocess. */
export type AnthropicAuthKind = 'gateway-key' | 'oauth-token';

export interface ActiveAnthropicKey {
  key: string;
  label: AnthropicKeyLabel;
  authKind: AnthropicAuthKind;
}

interface KeySlot {
  label: AnthropicKeyLabel;
  key: string;
  authKind: AnthropicAuthKind;
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
  // Claude subscription 5-hour-window exhaustion ("Claude AI usage limit
  // reached|<epoch>"). Deliberately narrow — a bare "rate limit" must NOT
  // match, or transient gateway 429s would knock healthy keys out of rotation.
  'usage limit reached',
];

/** True when the failure text indicates the key's balance/budget is drained. */
export function isBalanceExhaustedError(message: string | null | undefined): boolean {
  if (!message) return false;
  const h = message.toLowerCase();
  return BALANCE_EXHAUSTED_SIGNALS.some((s) => h.includes(s));
}

/**
 * True when an SDK `result` message represents a failure.
 *
 * The live LiteLLM gateway reports a balance 400 with `subtype: "success"` but
 * `is_error: true, api_error_status: 400` — so the error FLAG, not just a
 * non-success subtype, is the discriminator. A discriminator that checks only
 * `subtype` misses the gateway balance shape entirely.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isFailureResultMessage(msg: any): boolean {
  return msg?.is_error === true || (!!msg?.subtype && msg.subtype !== 'success');
}

/**
 * Extract balance-exhaustion error text from an SDK message, or null. The single
 * canonical detector shared by the main runner and every peripheral one-shot
 * call (salvage, title, segment-brief) so the discriminator can never drift.
 *
 * Two shapes carry it (verified live against the LiteLLM gateway):
 *   - a `result` message — see isFailureResultMessage for the subtype/is_error note;
 *   - an `assistant` message the CLI emits FIRST (model `<synthetic>`), whose only
 *     content is the short error echo — capped at 300 chars so a genuine long
 *     answer that merely mentions the phrase is never matched.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function balanceErrorTextOf(msg: any): string | null {
  if (msg?.type === 'result') {
    if (!isFailureResultMessage(msg)) return null;
    const text = typeof msg.result === 'string' ? msg.result : '';
    return isBalanceExhaustedError(text) ? text : null;
  }
  if (msg?.type === 'assistant') {
    const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
    const text = blocks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((b: any) => b?.type === 'text')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((b: any) => b.text ?? '')
      .join('');
    return text.length > 0 && text.length <= 300 && isBalanceExhaustedError(text) ? text : null;
  }
  return null;
}

// Lazily built so test mocks of config.js are honoured per-suite.
let slots: KeySlot[] | null = null;

function buildSlots(): KeySlot[] {
  const out: KeySlot[] = [];
  if (config.anthropicApiKey) out.push({ label: 'primary', key: config.anthropicApiKey, authKind: 'gateway-key' });
  if (config.anthropicApiStgKey) out.push({ label: 'stg', key: config.anthropicApiStgKey, authKind: 'gateway-key' });
  if (config.anthropicApiBackupKey) out.push({ label: 'backup', key: config.anthropicApiBackupKey, authKind: 'gateway-key' });
  if (config.anthropicSubscriptionOauthToken) {
    out.push({ label: 'subscription', key: config.anthropicSubscriptionOauthToken, authKind: 'oauth-token' });
  }
  if (config.anthropicSubscriptionOauthTokenVy) {
    out.push({ label: 'subscription-vy', key: config.anthropicSubscriptionOauthTokenVy, authKind: 'oauth-token' });
  }
  if (config.anthropicSubscriptionOauthTokenThi) {
    out.push({ label: 'subscription-thi', key: config.anthropicSubscriptionOauthTokenThi, authKind: 'oauth-token' });
  }
  return out;
}

function getSlots(): KeySlot[] {
  if (!slots) slots = buildSlots();
  return slots;
}

/**
 * Slots the active admin auth mode permits:
 *   - 'auto'    → all slots, in ladder priority order;
 *   - 'gateway' → gateway keys only (never burn subscription quota);
 *   - any other value is a specific slot LABEL (e.g. 'subscription',
 *     'subscription-vy') and pins to that single slot — the admin's
 *     "use this exact key for all users" choice.
 * Safety net: a mode whose lane/slot has no configured key (e.g. a token later
 * removed from env) falls back to the FULL ladder — a key must always be
 * available; the API layer rejects such a mode up front.
 */
function getEffectiveSlots(): KeySlot[] {
  const all = getSlots();
  const mode: LlmAuthMode = getLlmAuthMode();
  if (mode === 'auto') return all;
  const filtered =
    mode === 'gateway'
      ? all.filter((s) => s.authKind === 'gateway-key')
      : all.filter((s) => s.label === mode);
  if (filtered.length === 0) {
    console.warn(`[key-failover] auth mode '${mode}' has no configured slot — falling back to full ladder`);
    return all;
  }
  return filtered;
}

function cooldownMs(): number {
  return config.anthropicKeyRetryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS;
}

/** True when the gateway key is provisioned to serve this model. Models outside
 *  the grant 403 on every gateway key, so they must run on the OAuth lane. */
function gatewayCanServe(model: string): boolean {
  const list = config.gatewayServableModels;
  // Unconfigured (real config always sets it; only a partial test mock omits
  // it) → don't reroute: preserve the gateway-first ladder. An explicit empty
  // list means "gateway serves nothing" and is honoured.
  if (!Array.isArray(list)) return true;
  return list.includes(model);
}

/**
 * Slots eligible to serve `model`, narrowing the mode-permitted set when the
 * model can't run on the gateway. A gateway-unservable model (e.g. opus, while
 * the gateway key is sonnet-only) is restricted to OAuth slots so we never hand
 * a caller a key that's guaranteed to 403. When no OAuth slot exists (e.g. forced
 * 'gateway' mode, or no subscription token configured) the mode-permitted set is
 * returned unchanged — the request will 403 loudly rather than silently downgrade.
 */
function eligibleSlots(model?: string): KeySlot[] {
  const base = getEffectiveSlots();
  if (!model || gatewayCanServe(model)) return base;
  const oauth = base.filter((s) => s.authKind === 'oauth-token');
  return oauth.length > 0 ? oauth : base;
}

/** Number of eligible keys for `model` — the upper bound on per-turn retry attempts. */
export function anthropicKeyCount(model?: string): number {
  return eligibleSlots(model).length;
}

/**
 * The key the next LLM call should use: the highest-priority eligible key whose
 * exhausted mark is absent or has cooled down. All exhausted → the
 * least-recently-failed one (a key must always be returned). Pass the turn's
 * model so a gateway-unservable model is routed to the OAuth lane.
 */
export function getActiveAnthropicKey(model?: string): ActiveAnthropicKey {
  const all = eligibleSlots(model);
  if (all.length === 0) {
    // config.ts requires ANTHROPIC_API_KEY, so this only fires under broken
    // test mocks — fail loud rather than sending an empty key to the gateway.
    throw new Error('No Anthropic API keys configured');
  }
  const now = Date.now();
  const healthy = all.find(
    (s) => s.exhaustedAt === undefined || now - s.exhaustedAt > cooldownMs(),
  );
  if (healthy) return { key: healthy.key, label: healthy.label, authKind: healthy.authKind };
  const leastRecent = all.reduce((a, b) =>
    (a.exhaustedAt ?? 0) <= (b.exhaustedAt ?? 0) ? a : b,
  );
  return { key: leastRecent.key, label: leastRecent.label, authKind: leastRecent.authKind };
}

/**
 * Auth env vars for the SDK subprocess, matching the slot's auth kind:
 *   - gateway-key  → ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL (LiteLLM gateway)
 *   - oauth-token  → CLAUDE_CODE_OAUTH_TOKEN only — no base-url override, the
 *     CLI authenticates the subscription directly against api.anthropic.com.
 *     (On the proxied prod runner the forwarded https_proxy covers this host
 *     the same way it covers the gateway.)
 */
export function anthropicAuthEnvFor(active: ActiveAnthropicKey): Record<string, string> {
  if (active.authKind === 'oauth-token') {
    return { CLAUDE_CODE_OAUTH_TOKEN: active.key };
  }
  return { ANTHROPIC_API_KEY: active.key, ANTHROPIC_BASE_URL: config.anthropicBaseUrl };
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
export function reportKeyBalanceExhausted(usedKey: string, model?: string): KeyRotationResult {
  // Mark against the FULL slot list (an out-of-mode key can still be reported
  // by a racing caller after a mode flip), but compute "a healthy key remains"
  // within the slots eligible for this model only — rotation must not point
  // callers at a lane the admin switched off, nor at a gateway key that can't
  // serve the model.
  const slot = getSlots().find((s) => s.key === usedKey);
  if (!slot) return { rotated: false };
  slot.exhaustedAt = Date.now();
  // Rotation only counts when a genuinely healthy key remains — when every
  // key is drained, getActiveAnthropicKey() still hands out the least-recently
  // failed one, but retrying it immediately is futile; report no rotation so
  // callers surface the error instead of burning attempts.
  const now = Date.now();
  const healthy = eligibleSlots(model).find(
    (s) => s.exhaustedAt === undefined || now - s.exhaustedAt > cooldownMs(),
  );
  if (!healthy || healthy.key === usedKey) return { rotated: false };
  console.warn(
    `[key-failover] Anthropic key '${slot.label}' balance exhausted — switching to '${healthy.label}'`,
  );
  return { rotated: true, nextLabel: healthy.label };
}

/** Ops snapshot for /health and the admin toggle — labels only, never key material. */
export function keyFailoverStatus(): {
  mode: LlmAuthMode;
  active: AnthropicKeyLabel;
  configured: AnthropicKeyLabel[];
  exhausted: AnthropicKeyLabel[];
} {
  const all = getSlots();
  const now = Date.now();
  return {
    mode: getLlmAuthMode(),
    active: getActiveAnthropicKey().label,
    configured: all.map((s) => s.label),
    exhausted: all
      .filter((s) => s.exhaustedAt !== undefined && now - s.exhaustedAt <= cooldownMs())
      .map((s) => s.label),
  };
}

/** Auth kinds with at least one configured slot — mode validation for the admin API. */
export function configuredAuthKinds(): AnthropicAuthKind[] {
  const kinds = new Set<AnthropicAuthKind>(getSlots().map((s) => s.authKind));
  return [...kinds];
}

/** Configured slot labels — lets the admin API validate a pin-to-specific-key mode. */
export function configuredKeyLabels(): AnthropicKeyLabel[] {
  return getSlots().map((s) => s.label);
}

/** Reset module state — exposed for tests. */
export function __resetKeyFailoverForTests(): void {
  slots = null;
}
