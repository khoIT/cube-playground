/**
 * The advisor tool surface: deny-by-default allowlist, the pure-engine tools
 * register provenance (so ≥3 distinct tools land in one ledger), and the context
 * pack stays within budget while carrying the curated knowledge.
 */
import { describe, it, expect } from 'vitest';
import {
  buildAdvisorToolServer,
  ADVISOR_TOOL_ALLOWLIST,
  ADVISOR_SERVER_NAME,
} from '../src/advisor/agent/tools/index.js';
import { ProvenanceLedger } from '../src/advisor/agent/agent-provenance-gate.js';
import { buildContextPack, CONTEXT_PACK_MAX_CHARS } from '../src/advisor/agent/agent-context-pack.js';
import type { ToolContext } from '../src/advisor/agent/tools/tool-context.js';
import type { ScopeRef } from '../src/advisor/diagnosis-types.js';

const SCOPE: ScopeRef = { kind: 'segment', segmentId: 'seg-x', gameId: 'cfm_vn' };

function makeCtx(ledger: ProvenanceLedger): ToolContext {
  return {
    sessionId: 'sess-x',
    scope: SCOPE,
    goal: 'revenue',
    ctx: { cubeApiUrl: 'http://stub', token: null },
    asOf: new Date('2026-06-15T00:00:00Z'),
    ledger,
  };
}

/** Pull a tool's handler by bare name from the built server's registry. */
function toolHandler(server: ReturnType<typeof buildAdvisorToolServer>, name: string) {
  const registered = (
    server as unknown as {
      instance: {
        _registeredTools: Record<
          string,
          { handler: (a: Record<string, unknown>, e: unknown) => Promise<Record<string, unknown>> }
        >;
      };
    }
  ).instance._registeredTools;
  const found = registered[name];
  if (!found) throw new Error(`tool ${name} not on server`);
  return found.handler;
}

describe('advisor tool allowlist', () => {
  it('exposes exactly the 11 advisor tools, all mcp__advisor__-prefixed', () => {
    expect(ADVISOR_TOOL_ALLOWLIST).toHaveLength(11);
    expect(ADVISOR_TOOL_ALLOWLIST.every((n) => n.startsWith(`mcp__${ADVISOR_SERVER_NAME}__`))).toBe(true);
  });

  it('does NOT expose a member-row tool (no PII surface)', () => {
    expect(ADVISOR_TOOL_ALLOWLIST.some((n) => /member|segment_members/i.test(n))).toBe(false);
  });
});

describe('pure-engine tools register provenance', () => {
  it('records ≥3 distinct tool results in one session ledger', async () => {
    const ledger = new ProvenanceLedger();
    const server = buildAdvisorToolServer(makeCtx(ledger));

    const lever = await toolHandler(server, 'map_levers')({ factor: 'lifespan' }, {});
    expect(lever.structuredContent).toHaveProperty('provenanceId');

    const power = await toolHandler(server, 'check_power')(
      { N: 2400, reachablePct: 0.75, windowDays: 14, baselineRate: 0.4 },
      {},
    );
    expect(power.structuredContent).toHaveProperty('provenanceId');

    const money = await toolHandler(server, 'expected_incremental')(
      { effectFraction: 0.06, addressableN: 2400, valuePerUnit: 850_000 },
      {},
    );
    const moneyStruct = money.structuredContent as { provenanceId: string };
    expect(moneyStruct.provenanceId).toBeTruthy();

    // 3 distinct tools → 3 ledger entries; an output value is provenanced
    // (perUnitVnd is echoed into the money estimate).
    expect(ledger.size()).toBe(3);
    expect(ledger.contains(moneyStruct.provenanceId, 850_000)).toBe(true);
  });

  it('predicate_compile returns SQL without executing', async () => {
    const ledger = new ProvenanceLedger();
    const server = buildAdvisorToolServer(makeCtx(ledger));
    const res = await toolHandler(server, 'predicate_compile')(
      {
        predicate: {
          kind: 'group',
          id: 'g1',
          op: 'AND',
          children: [{ kind: 'leaf', id: 'l1', member: 'mf_users.lifespan', type: 'number', op: 'gte', values: [30] }],
        },
      },
      {},
    );
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { sql: string }).sql).toContain('lifespan');
  });
});

describe('context pack', () => {
  const pack = buildContextPack(SCOPE);
  it('stays under the injection budget', () => {
    expect(pack.length).toBeLessThanOrEqual(CONTEXT_PACK_MAX_CHARS);
  });
  it('carries the curated knowledge (goal trees, levers, playbooks, scope)', () => {
    expect(pack).toContain('seg-x');
    expect(pack).toContain('win-back'); // a lever family
    expect(pack).toMatch(/Revenue:/);
    expect(pack).toMatch(/playbook/i);
  });
});
