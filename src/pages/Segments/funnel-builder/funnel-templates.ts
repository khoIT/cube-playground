/**
 * Pre-baked funnel templates — Phase 4.1.
 *
 * Removes blank-slate paralysis from the funnel wizard. Each template ships
 * with a recommended event order and conversion window. Users can still
 * customize after picking; the template just seeds Step 1.
 */

export interface FunnelTemplate {
  id: string;
  label: string;
  description: string;
  orderedEvents: string[];
  windowMs: number;
}

const ONE_DAY_MS = 86_400_000;

export const FUNNEL_TEMPLATES: FunnelTemplate[] = [
  {
    id: 'onboarding',
    label: 'Onboarding',
    description: 'register → login → first_recharge',
    orderedEvents: ['register', 'login', 'first_recharge'],
    windowMs: 7 * ONE_DAY_MS,
  },
  {
    id: 'activation',
    label: 'Activation',
    description: 'register → login (day-0 close-the-loop)',
    orderedEvents: ['register', 'login'],
    windowMs: 1 * ONE_DAY_MS,
  },
  {
    id: 'monetization',
    label: 'Monetization',
    description: 'login → recharge (any-time)',
    orderedEvents: ['login', 'recharge'],
    windowMs: 30 * ONE_DAY_MS,
  },
];

export function findTemplateById(id: string): FunnelTemplate | undefined {
  return FUNNEL_TEMPLATES.find((t) => t.id === id);
}
