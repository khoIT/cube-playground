/**
 * LLM phrasing pass: produces 3 defensible hypothesis strings for an
 * ExperimentCandidate. The LLM proposes WORDING ONLY — it never reorders
 * candidates or invents lift numbers. All numeric inputs come from the ranker.
 *
 * Default caller: spawns the cube-advisor `claude -p` CLI (sibling app at
 * ../cube-advisor), mirroring the briefing-console pattern. The llmCaller
 * parameter is injectable so tests and offline environments can pass a
 * deterministic stub without touching the filesystem.
 *
 * Graceful degradation: when the CLI is absent, network is unavailable, or
 * the spawn fails, phraseHypotheses() returns template-generated strings and
 * logs a warning. The candidate is fully usable — hypotheses are additive.
 *
 * DEFERRED TO HOST: live LLM execution requires the cube-advisor sibling app
 * at ../cube-advisor and a reachable gateway. This module compiles and is
 * unit-testable offline; live calls are a no-op on this machine.
 */

import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExperimentCandidate } from './candidate-types.js';
import type { Diagnosis } from './diagnosis-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── LLM caller interface ─────────────────────────────────────────────────────

/**
 * Injectable LLM caller. Receives a prompt string, returns the model response.
 * Default implementation spawns the cube-advisor CLI; tests inject a stub.
 */
export type LlmCallerFn = (prompt: string) => Promise<string>;

// ─── Default caller (cube-advisor CLI spawn) ──────────────────────────────────

/**
 * Spawn `claude -p <prompt>` via the cube-advisor sibling app.
 * DEFERRED TO HOST: requires ../cube-advisor to be present and the claude CLI
 * to be installed and authenticated. On this machine (no live LLM gateway),
 * this will throw and phraseHypotheses() will fall back to templates.
 */
async function spawnCubeAdvisorCli(prompt: string): Promise<string> {
  // cube-advisor lives as a sibling of cube-playground
  const cubeAdvisorPath = join(__dirname, '..', '..', '..', '..', 'cube-advisor');

  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', prompt], {
      cwd: cubeAdvisorPath,
      timeout: 30_000,
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => errChunks.push(d));

    child.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString('utf8').slice(0, 200);
        reject(new Error(`claude -p exited ${code}: ${stderr}`));
      } else {
        resolve(Buffer.concat(chunks).toString('utf8').trim());
      }
    });

    child.on('error', reject);
  });
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPhrasingPrompt(diagnosis: Diagnosis, candidate: ExperimentCandidate): string {
  const { opportunityFactor, lever, expectedEffect, power, money } = candidate;
  const pct = (expectedEffect.value * 100).toFixed(0);
  const moneyStr =
    money.incrementalVnd != null
      ? `₫${(money.incrementalVnd / 1_000_000).toFixed(1)}M estimated incremental`
      : '₫ TBD';

  return `You are writing experiment hypothesis cards for a game customer-success team.

Context:
- Factor under-performing: ${opportunityFactor}
- Lever: ${lever.family} (${lever.description})
- Expected effect: +${pct}% (confidence: ${expectedEffect.confidence}, source: ${expectedEffect.source})
- Statistical power: ${power.status} — MDE ${power.mde} pp — ${power.detail}
- Estimated impact: ${moneyStr}

Task: Write exactly 3 SHORT, defensible experiment hypotheses (1–2 sentences each).
Rules:
1. Each hypothesis must be phrased as "If [treatment], then [measurable outcome] because [mechanism]."
2. Do NOT invent lift numbers — use only the numbers given above.
3. Do NOT reorder or compare to other candidates.
4. Keep wording clear for a non-technical CS manager.

Return ONLY the 3 hypotheses as a JSON array of strings, e.g.:
["Hypothesis 1...", "Hypothesis 2...", "Hypothesis 3..."]`;
}

// ─── Template fallback ────────────────────────────────────────────────────────

/**
 * Deterministic template hypotheses used when the LLM is unavailable.
 * Numbers come verbatim from the candidate — no fabrication.
 */
function templateHypotheses(candidate: ExperimentCandidate): string[] {
  const { opportunityFactor, lever, expectedEffect, power } = candidate;
  const pct = (expectedEffect.value * 100).toFixed(0);
  const conf = expectedEffect.confidence;

  return [
    `If the CS team delivers the "${lever.family}" intervention to this segment, ` +
      `then "${opportunityFactor}" will improve by approximately ${pct} pp ` +
      `because targeted outreach re-engages at-risk members. (Prior: ${conf})`,

    `If members receive personalised outreach via "${lever.actuator}" channel, ` +
      `then retention for the "${opportunityFactor}" factor will recover within the experiment window ` +
      `because direct contact reduces friction. (Prior: ${conf})`,

    `If the experiment runs for the planned window with ${power.detail}, ` +
      `then we will detect a ≥${power.mde} pp lift in "${opportunityFactor}" at 80% power, ` +
      `confirming whether the "${lever.family}" lever drives the expected ${pct} pp effect. (Prior: ${conf})`,
  ];
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseHypothesesResponse(raw: string): string[] | null {
  // Extract JSON array from the response (model may wrap with prose)
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      parsed.every((h) => typeof h === 'string')
    ) {
      return parsed as string[];
    }
  } catch {
    // fall through
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Produce 3 phrased experiment hypotheses for a candidate.
 *
 * - When llmCaller is provided, it is called with the constructed prompt.
 * - When omitted, defaults to the cube-advisor CLI spawn.
 * - On any error (CLI absent, timeout, parse failure), falls back silently to
 *   deterministic templates and logs a warning. The candidate is still complete.
 *
 * The returned strings are additive — they do not affect score or rank order.
 * Mutates candidate.hypotheses in-place and returns the strings.
 */
export async function phraseHypotheses(
  diagnosis: Diagnosis,
  candidate: ExperimentCandidate,
  llmCaller?: LlmCallerFn,
): Promise<string[]> {
  const caller = llmCaller ?? spawnCubeAdvisorCli;
  const prompt = buildPhrasingPrompt(diagnosis, candidate);

  let hypotheses: string[];

  try {
    const raw = await caller(prompt);
    const parsed = parseHypothesesResponse(raw);
    if (parsed) {
      hypotheses = parsed;
    } else {
      console.warn('[llm-phrasing] Could not parse LLM response — using templates');
      hypotheses = templateHypotheses(candidate);
    }
  } catch (err) {
    // DEFERRED TO HOST: live LLM unavailable on this machine — template fallback
    console.warn(
      '[llm-phrasing] LLM call failed (deferred to host with live gateway):',
      (err as Error).message,
    );
    hypotheses = templateHypotheses(candidate);
  }

  candidate.hypotheses = hypotheses;
  return hypotheses;
}
