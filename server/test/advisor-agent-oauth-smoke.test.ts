/**
 * Live OAuth-lane smoke — proves the in-process agent actually runs on the
 * Claude subscription OAuth lane end-to-end.
 *
 * HOST-GATED: skipped unless a subscription token is present (CI / Docker /
 * a bare shell will skip). On the token-bearing host it drives ONE real
 * investigation turn and asserts the lane-level invariants:
 *   - the turn completes with a terminal `done` event (the SDK answered),
 *   - cost was recorded (a real billed model turn, not a stub),
 *   - no `sdk_error`/`oauth_*` error surfaced (the OAuth token authenticated).
 *
 * It deliberately does NOT assert exact wording (stochastic) or require live
 * Cube — data tools may fail-closed on a Cube-less host, but the OAuth lane,
 * the agent loop, the guardrails, and the pure tools still exercise. The live
 * Cube run (cfm_vn / jus_vn against real ops cubes) stays host-gated to a
 * Cube-connected host and is documented in the phase plan, not automated here.
 */
import { describe, it, expect } from 'vitest';
import { createAdvisorAgentSession } from '../src/advisor/agent/agent-runtime.js';
import { resolveOAuthToken } from '../src/advisor/agent/agent-oauth-env.js';
import type { RuntimeEvent } from '../src/advisor/agent/agent-types.js';
import type { ScopeRef } from '../src/advisor/diagnosis-types.js';

const hasToken = !!resolveOAuthToken();
const TURN_TIMEOUT_MS = 180_000;

describe.skipIf(!hasToken)('live OAuth-lane smoke (host-gated)', () => {
  it(
    'runs one real investigation turn on the OAuth lane and records cost',
    async () => {
      const scope: ScopeRef = { kind: 'game', gameId: 'cfm_vn' };
      const session = createAdvisorAgentSession('smoke-1', {
        scope,
        goal: 'revenue',
        ctx: {
          cubeApiUrl: process.env.CUBEJS_API_URL ?? 'http://localhost:4000/cubejs-api/v1',
          token: process.env.CUBEJS_API_TOKEN ?? null,
        },
        owner: 'oauth-smoke',
      });

      const events: RuntimeEvent[] = [];
      try {
        for await (const ev of session.runTurn(
          'We want to grow revenue from our highest-value cfm_vn players. Walk the causal ' +
            'chain briefly, then check statistical power for a win-back experiment on about ' +
            '3000 reachable members at a 40% baseline churn rate.',
          'drive',
        )) {
          events.push(ev);
        }
      } finally {
        session.abort('smoke-complete');
      }

      const done = events.find((e) => e.type === 'done');
      const errors = events.filter((e) => e.type === 'error');

      // The lane answered: exactly one terminal done event, no auth/SDK error.
      expect(done, `events: ${JSON.stringify(events.map((e) => e.type))}`).toBeDefined();
      const fatal = errors.filter(
        (e) => e.type === 'error' && (e.code === 'oauth_missing' || e.code === 'sdk_error'),
      );
      expect(fatal, JSON.stringify(fatal)).toEqual([]);

      // A real billed model turn records cost (> 0). Stubs never do.
      expect(session.totalCostUsd).toBeGreaterThan(0);
    },
    TURN_TIMEOUT_MS,
  );
});
