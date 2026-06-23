/**
 * Smart-default / ask-frugal policy (P3).
 *
 * Codifies "default + state + offer correction": when a low-impact slot is
 * unresolved but a sensible default exists, the agent answers with the default,
 * STATES the assumption, and attaches a one-click correction chip — instead of
 * blocking with a question. High-impact ambiguity (the ranking entity grain,
 * which changes the answer) still asks first.
 *
 * The only per-game default is the metric: the game's Revenue measure resolved
 * via the glossary concept (a logical member ref the downstream member-resolver
 * maps per workspace). If no revenue measure resolves, metric becomes ask-first
 * (never silently wrong). Time defaults to a fixed last-30-days window; entity
 * grain is the one high-impact slot. This is a small explicit table, not vibes.
 */

import type { OfficialTerm } from '../nl-to-query/types.js';

export interface RevenueDefault {
  /** Logical measure ref, e.g. `recharge.revenue_vnd`. */
  ref: string;
  /** Human label, e.g. `Revenue`. */
  label: string;
}

/**
 * Resolve the game's default metric — its Revenue measure — from the glossary.
 * Prefers an explicit `revenue` concept with a measure ref; else the first
 * revenue-category measure term. Returns null when no revenue measure exists
 * (the caller then treats metric as ask-first). Ratio terms (ARPU etc.) are
 * never a default — they are population averages, not a per-entity amount.
 */
export function resolveRevenueDefault(glossary: OfficialTerm[]): RevenueDefault | null {
  const byId = glossary.find((t) => t.id === 'revenue' && t.refKind !== 'ratio' && t.measureRef);
  if (byId?.measureRef) return { ref: byId.measureRef, label: byId.label };
  const byCategory = glossary.find(
    (t) => (t.category ?? '').toLowerCase() === 'revenue' && t.refKind === 'measure' && t.measureRef,
  );
  if (byCategory?.measureRef) return { ref: byCategory.measureRef, label: byCategory.label };
  return null;
}

/**
 * Resolve the game's active-user count measure (DAU) from the glossary — the
 * population default for a bare segment/time question. Prefers the canonical
 * `active-user`/`dau` concept; else any measure term whose ref leaf is `dau`.
 * Returns null when none resolves (caller then leaves metric ask-first).
 */
const ACTIVE_USER_IDS = ['active-user', 'active_user', 'active-users', 'dau', 'daily-active-users'];

export function resolveActiveUserDefault(glossary: OfficialTerm[]): RevenueDefault | null {
  for (const id of ACTIVE_USER_IDS) {
    const t = glossary.find((x) => x.id === id && x.refKind !== 'ratio' && x.measureRef);
    if (t?.measureRef) return { ref: t.measureRef, label: t.label };
  }
  const byLeaf = glossary.find(
    (t) => t.refKind === 'measure' && !!t.measureRef && t.measureRef.endsWith('.dau'),
  );
  if (byLeaf?.measureRef) return { ref: byLeaf.measureRef, label: byLeaf.label };
  return null;
}

// A money intent in the message → default to Revenue instead of population.
// Word-boundary anchored so "player" can't trip "pay"; covers the common
// spend/revenue/ARPU/paid/sales/LTV/VND vocabulary (EN + the VND currency cue).
const MONEY_CUE = /\b(revenue|spend(?:ing|s|t)?|arpu|arppu|arpdau|paid|payments?|sales|moneti[sz]\w*|gross|ltv|money|vnd)\b/i;

/** True when the message carries a money cue (spend / revenue / ARPU / …). */
export function messageHasMoneyCue(message: string): boolean {
  return MONEY_CUE.test(message);
}

/**
 * The deterministic default metric for a segment/time question that names no
 * metric (user decision, 2026-06-23): a money cue → the game's Revenue measure,
 * otherwise the active-user population count. Returns null only when neither
 * resolves from the glossary — the caller then leaves the metric for clarify.
 */
export function resolveDefaultMetric(glossary: OfficialTerm[], message: string): RevenueDefault | null {
  if (messageHasMoneyCue(message)) {
    const rev = resolveRevenueDefault(glossary);
    if (rev) return rev;
  }
  return resolveActiveUserDefault(glossary) ?? resolveRevenueDefault(glossary);
}

/**
 * Render the smart-default guidance for the system prompt. Stable per game
 * (depends only on the glossary's revenue measure), so it is safe to place in
 * the cacheable prefix. Returns '' only in the degenerate empty case.
 */
export function renderSmartDefaults(revenue: RevenueDefault | null): string {
  const lines: string[] = [];
  lines.push('## Smart defaults (answer, don\'t ask)');
  lines.push('');
  lines.push(
    'When the user omits a LOW-IMPACT slot, proceed with the default below, STATE the ' +
      'assumption in one short line, and end the turn with an offer_choices chip to change it. ' +
      'Do NOT block with a clarifying question for these:',
  );
  if (revenue) {
    lines.push(
      `- metric: default to the game's Revenue measure ({{field:${revenue.ref}}}, "${revenue.label}") when no metric is named.`,
    );
  } else {
    lines.push(
      '- metric: this game has no resolvable Revenue measure — ask which metric (do NOT guess).',
    );
  }
  lines.push('- time window: default to the last 30 days when no window is named.');
  lines.push('');
  lines.push(
    'Ask FIRST (HIGH-IMPACT — the choice changes the answer) only for the ranking entity grain: ' +
      'whether "top N" means individuals (players / users / accounts / spenders) or groups ' +
      '(countries / channels / segments / servers). Infer it from the nouns when you can; ask only ' +
      'when genuinely ambiguous. Never default the grain silently.',
  );
  return lines.join('\n');
}
