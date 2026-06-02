/**
 * Latency-under-load harness.
 *
 * Method (not raw throughput — the bug here is interactive latency collapsing
 * under concurrent load, the signature of single-thread / synchronous-sqlite
 * starvation):
 *
 *   1. BASELINE  — probe a cheap endpoint (/health) at 1 connection while the
 *      stack is idle. Record p50/p99 — this is "a click when nothing else runs".
 *   2. UNDER LOAD — fire the scenario's heavy requests at N connections AND run
 *      the same probe concurrently. Record the probe's p50/p99 during load.
 *   3. VERDICT   — if the probe's p99 balloons under load (>= 3x baseline and
 *      >= 500ms), the loop is being starved: heavy work blocks the cheap path.
 *
 * Usage (after `npm install` in this dir):
 *   node run-load.mjs                      # default: server-reads, 20s @ 20 conns
 *   node run-load.mjs chat-reads
 *   node run-load.mjs --all
 *   node run-load.mjs cube-meta --duration=30 --connections=40
 *   node run-load.mjs --list
 *
 * Env overrides: SERVER_URL, CHAT_URL, GAME, WORKSPACE.
 */

import autocannon from 'autocannon';
import { scenarios, scenarioNames } from './scenarios.mjs';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const has = (name) => args.includes(`--${name}`);

if (has('list')) {
  console.log('Scenarios:', scenarioNames.join(', '));
  process.exit(0);
}

const DURATION = parseInt(flag('duration', '20'), 10);
const CONNECTIONS = parseInt(flag('connections', '20'), 10);
const BASELINE = parseInt(flag('baseline', '5'), 10);

const ms = (n) => `${Math.round(n)}ms`.padStart(7);

async function fire(url, requests, { connections, duration, headers }) {
  return autocannon({
    url,
    connections,
    duration,
    headers,
    requests: requests.map((r) => ({ ...r })),
    // Keep one slow request from wedging a connection for the whole run.
    timeout: 30,
  });
}

async function runScenario(name) {
  const sc = scenarios[name];
  if (!sc) {
    console.error(`Unknown scenario "${name}". Try --list.`);
    process.exit(1);
  }
  const probeReq = [{ method: 'GET', path: sc.probe, headers: sc.headers }];

  console.log(`\n${'='.repeat(60)}\n  SCENARIO: ${name}  (${sc.url})\n${'='.repeat(60)}`);
  console.log(`  driving ${sc.requests.length} path(s) @ ${CONNECTIONS} conns for ${DURATION}s`);
  console.log(`  probing ${sc.probe} @ 1 conn\n`);

  // 1. Baseline — probe alone.
  const base = await fire(sc.url, probeReq, { connections: 1, duration: BASELINE, headers: sc.headers });

  // 2. Under load — heavy load + probe, concurrently.
  const [load, probe] = await Promise.all([
    fire(sc.url, sc.requests, { connections: CONNECTIONS, duration: DURATION, headers: sc.headers }),
    fire(sc.url, probeReq, { connections: 1, duration: DURATION, headers: sc.headers }),
  ]);

  // 3. Report.
  const bP99 = base.latency.p99;
  const uP99 = probe.latency.p99;
  const blowup = bP99 > 0 ? (uP99 / bP99).toFixed(1) : (uP99 > 0 ? '∞' : '1.0');
  const bad = (load.non2xx || 0) + (load.errors || 0) + (load.timeouts || 0);

  console.log(`  PROBE  baseline    p50=${ms(base.latency.p50)}  p99=${ms(bP99)}`);
  console.log(`  PROBE  under load  p50=${ms(probe.latency.p50)}  p99=${ms(uP99)}   (x${blowup} baseline)`);
  console.log(`  LOAD   ${Math.round(load.requests.average)} req/s   p99=${ms(load.latency.p99)}   ` +
    `2xx=${load['2xx']}  non2xx=${load.non2xx || 0}  errors=${load.errors || 0}  timeouts=${load.timeouts || 0}`);

  const starved = uP99 >= 500 && uP99 >= bP99 * 3;
  if (starved) {
    console.log(`  ⚠ VERDICT: event-loop STARVATION — cheap-path p99 ${ms(uP99)} under load vs ${ms(bP99)} idle.`);
  } else if (bad > 0) {
    console.log(`  ⚠ VERDICT: ${bad} failed responses under load (see non2xx/errors/timeouts).`);
  } else {
    console.log(`  ✓ VERDICT: cheap path held up (p99 ${ms(uP99)} under load).`);
  }
  return { name, baselineP99: bP99, underLoadP99: uP99, blowup, bad };
}

const targets = has('all') ? scenarioNames : [args.find((a) => !a.startsWith('--')) ?? 'server-reads'];
const results = [];
for (const t of targets) results.push(await runScenario(t));

if (results.length > 1) {
  console.log(`\n${'='.repeat(60)}\n  SUMMARY\n${'='.repeat(60)}`);
  for (const r of results) {
    console.log(`  ${r.name.padEnd(14)} idle p99 ${ms(r.baselineP99)}  →  load p99 ${ms(r.underLoadP99)}  (x${r.blowup})  failures=${r.bad}`);
  }
}
