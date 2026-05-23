/**
 * Intent router — maps a user message to a skill name.
 * Stub: always returns 'explore' with full confidence. The real keyword
 * heuristic (VN + EN) will land alongside the additional skills.
 */

export interface IntentResult {
  skill: string;
  confidence: number;
  autoRoute: boolean;
}

export function routeIntent(_message: string): IntentResult {
  return { skill: 'explore', confidence: 1, autoRoute: true };
}
