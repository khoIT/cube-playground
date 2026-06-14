/**
 * Per-session provenance ledger + the HYBRID "free Explore / gated Decide" gate.
 *
 * Every numeric tool result is registered here with a stable provenanceId and
 * the set of finite numbers it produced. The agent may reason freely in the
 * transcript (those numbers are tagged "exploratory" by the UI), but any number
 * that lands in a recommendation card or an experiment draft MUST carry a
 * provenanceId present in this ledger AND match a value the ledger recorded for
 * that id. This is what stops the agent paraphrasing a tool number into a
 * different value and presenting it as fact.
 *
 * The ledger is per-session (one investigation) and lives in memory only —
 * never persisted, never logged.
 *
 * v1 LIMITATION (coincidence-tolerant, not field-bound): a claim is accepted if
 * its value equals ANY number recorded for the cited tool result, not the value
 * at a specific field path. This catches gross fabrication (a number absent from
 * the result) but not a forged value that happens to equal an unrelated number
 * in the same payload (e.g. a 0.75 reachable fraction). Tightening to a
 * field-bound match is a tracked follow-up; until then the gate is a strong
 * "did this come from a tool" check, not a strict per-field equality proof.
 */

/** One registered tool result. */
interface LedgerEntry {
  provenanceId: string;
  tool: string;
  /** All finite numbers the tool output contained (for the value-match check). */
  numbers: number[];
  ts: number;
}

/** A numeric claim the agent attaches to a card/draft field. */
export interface NumberClaim {
  field: string;
  value: number;
  provenanceId?: string;
}

/** A rejected claim with the reason. */
export interface ProvenanceViolation {
  field: string;
  value: number;
  reason: 'missing_provenance' | 'unknown_provenance' | 'value_mismatch';
}

/** Relative tolerance for the value-match check (rounding/formatting drift). */
const MATCH_EPSILON_REL = 1e-6;
const MATCH_EPSILON_ABS = 1e-6;

/** Recursively collect every finite number in an arbitrary tool output. */
export function collectNumbers(value: unknown, acc: number[] = []): number[] {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) acc.push(value);
  } else if (typeof value === 'string') {
    const n = Number(value);
    if (value.trim() !== '' && Number.isFinite(n)) acc.push(n);
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, acc);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectNumbers(v, acc);
  }
  return acc;
}

function numbersMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(MATCH_EPSILON_ABS, MATCH_EPSILON_REL * Math.abs(b));
}

export class ProvenanceLedger {
  private readonly entries = new Map<string, LedgerEntry>();
  private seq = 0;

  /**
   * Register a tool result and return its provenanceId. The id is stable within
   * the session (tool name + monotonic sequence) so it can be cited in cards.
   */
  register(tool: string, output: unknown): string {
    this.seq += 1;
    const provenanceId = `${tool}#${this.seq}`;
    this.entries.set(provenanceId, {
      provenanceId,
      tool,
      numbers: collectNumbers(output),
      ts: Date.now(),
    });
    return provenanceId;
  }

  has(provenanceId: string): boolean {
    return this.entries.has(provenanceId);
  }

  /** True when `value` was among the numbers the given entry recorded. */
  contains(provenanceId: string, value: number): boolean {
    const entry = this.entries.get(provenanceId);
    if (!entry) return false;
    return entry.numbers.some((n) => numbersMatch(value, n));
  }

  size(): number {
    return this.entries.size;
  }

  /**
   * Validate a list of numeric claims. A claim passes only when it cites a known
   * provenanceId whose recorded output contained the claimed value.
   */
  validateClaims(claims: NumberClaim[]): ProvenanceViolation[] {
    const violations: ProvenanceViolation[] = [];
    for (const claim of claims) {
      if (!claim.provenanceId) {
        violations.push({ field: claim.field, value: claim.value, reason: 'missing_provenance' });
      } else if (!this.has(claim.provenanceId)) {
        violations.push({ field: claim.field, value: claim.value, reason: 'unknown_provenance' });
      } else if (!this.contains(claim.provenanceId, claim.value)) {
        violations.push({ field: claim.field, value: claim.value, reason: 'value_mismatch' });
      }
    }
    return violations;
  }
}

/**
 * Validate the headline numbers of an experiment draft against a single
 * provenanceId (the recommend/scaffold result that produced it). Returns the
 * violations — empty array means every required number traces to the tool.
 */
export function validateDraftNumbers(
  draft: {
    cohort?: { addressableN?: number };
    power?: { mde?: number };
    expectedEffect?: { value?: number };
    money?: { incrementalVnd?: number | null };
  },
  provenanceId: string | undefined,
  ledger: ProvenanceLedger,
): ProvenanceViolation[] {
  const claims: NumberClaim[] = [];
  const push = (field: string, value: number | null | undefined): void => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      claims.push({ field, value, provenanceId });
    }
  };
  push('cohort.addressableN', draft.cohort?.addressableN);
  push('power.mde', draft.power?.mde);
  push('expectedEffect.value', draft.expectedEffect?.value);
  push('money.incrementalVnd', draft.money?.incrementalVnd ?? undefined);
  return ledger.validateClaims(claims);
}
