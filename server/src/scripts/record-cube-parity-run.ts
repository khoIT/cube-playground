/**
 * CLI trigger: run the cross-game Cube parity audit harness and persist the
 * result into segments.db (migration 067). On-demand entry point; the same
 * recorder is invoked by the Model Audit "Run audit now" route.
 *
 *   npm run audit:cube-parity-record           (server/)
 *   npm run audit:cube-parity-record -- --prod-root /path/to/cube-prod
 */

import { runAndRecord } from '../services/cube-parity-recorder.js';

function parseProdRoot(argv: string[]): string | undefined {
  const i = argv.indexOf('--prod-root');
  return i >= 0 ? argv[i + 1] : undefined;
}

const result = runAndRecord({ prodRoot: parseProdRoot(process.argv.slice(2)) });
console.log(
  `Recorded cube parity run #${result.runId}: ${result.findingCount} findings ` +
    `(🔴 ${result.counts.correctness} · 🟡 ${result.counts.parity} · ⚪ ${result.counts.cosmetic}), ` +
    `${result.newBlobs} new YAML blob(s).`,
);
