/**
 * End-to-end eval of the disambiguation engine against the hand-curated
 * corpus. Mocks the glossary HTTP layer so the run is fully deterministic.
 * Prints a calibration report alongside the assertions so the team can
 * defensibly tune the auto-resolve threshold over time.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disambiguate } from '../../src/nl-to-query/index.js';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';
import { calibrate, type EvalDecision } from './calibration-report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface FixtureFile { version: number; terms: OfficialTerm[] }
interface CorpusCase {
  id: string;
  message: string;
  language: 'vi' | 'en' | 'mixed';
  mode: 'targeted' | 'aggressive';
  expect: {
    action: 'auto' | 'clarify';
    metric?: string;
    dimension?: string;
    filterMembers?: string[];
    hasTimeRange?: boolean;
    clarificationSlot?: string;
  };
}
interface CorpusFile { now: string; cases: CorpusCase[] }

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'glossary-fixture.json'), 'utf-8')) as FixtureFile;
const corpus = JSON.parse(readFileSync(resolve(__dirname, 'eval-corpus.json'), 'utf-8')) as CorpusFile;

const knownMembers = new Set(
  fixture.terms.map((t) => t.primaryCatalogId).filter((m): m is string => !!m),
);

const fixedNow = new Date(corpus.now).getTime();

async function runEngine(c: CorpusCase) {
  return disambiguate(
    { message: c.message, mode: c.mode, knownMembers },
    {
      now: () => fixedNow,
      fetchOfficialGlossary: async () => fixture.terms,
    },
  );
}

describe('nl-to-query engine eval', () => {
  const decisions: EvalDecision[] = [];
  let actionMatches = 0;
  let slotMatches = 0;
  let cases = 0;

  for (const c of corpus.cases) {
    it(`[${c.id}] action and slot match expectations`, async () => {
      const r = await runEngine(c);
      cases += 1;
      decisions.push({
        id: c.id,
        overallConfidence: r.overallConfidence,
        expectedAction: c.expect.action,
        mode: c.mode,
        hadClarifications: r.clarifications.length > 0,
      });

      expect(r.action).toBe(c.expect.action);
      if (r.action === c.expect.action) actionMatches += 1;

      if (c.expect.metric) {
        expect(r.slots.metric.value).toBe(c.expect.metric);
      }
      if (c.expect.dimension) {
        expect(r.slots.dimension?.value).toBe(c.expect.dimension);
      }
      if (c.expect.hasTimeRange) {
        expect(r.slots.timeRange?.value).toBeTruthy();
      }
      if (c.expect.filterMembers && c.expect.filterMembers.length > 0) {
        const got = (r.slots.filters ?? []).map((f) => f.member);
        for (const m of c.expect.filterMembers) expect(got).toContain(m);
      }
      if (c.expect.clarificationSlot) {
        expect(r.clarifications[0]?.slot).toBe(c.expect.clarificationSlot);
      }
      slotMatches += 1;
    });
  }

  it('overall pass-rate >= 0.85 on action correctness', () => {
    // Action correctness is the primary signal. Runs after the per-case
    // tests; if any per-case assertion threw, actionMatches stays low.
    const rate = cases === 0 ? 0 : actionMatches / cases;
    // Print calibration table — informational only.
    // eslint-disable-next-line no-console
    console.table(calibrate(decisions));
    // eslint-disable-next-line no-console
    console.log(`eval pass-rate: action=${actionMatches}/${cases} (${(rate * 100).toFixed(1)}%); slots=${slotMatches}/${cases}`);
    expect(rate).toBeGreaterThanOrEqual(0.85);
  });
});
