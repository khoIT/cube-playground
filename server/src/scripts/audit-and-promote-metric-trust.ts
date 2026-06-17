/**
 * audit-and-promote-metric-trust — roll the per-game metric-trust audit out to
 * every game on the local workspace.
 *
 * Companion to check-metric-drift.ts. That script is the read-only CI drift
 * gate; this one classifies AND can act — it certifies the drafts that are
 * safe to certify and groups the rest by *why* they're blocked, turning the
 * modeling backlog into a worklist instead of a scavenger hunt.
 *
 * Drives the running server's HTTP API so the governed cert gate (ref
 * validation + admin check + trust_history append) runs exactly as it does in
 * the UI — the script never writes YAML directly.
 *
 * For each game:
 *   GET /api/business-metrics?game=G       → resolved trust + applicability
 *   GET /api/business-metrics/drift?game=G → refs that don't resolve vs /meta
 * Then each metric lands in one bucket:
 *   - CERTIFIED                              already trusted
 *   - READY     draft + refs resolve + applicable   → certify with --promote
 *   - GAP       refs unresolved + applicable         → real: needs modeling
 *   - N/A       refs unresolved + applicable:false   → expected, documented
 *
 *   tsx src/scripts/audit-and-promote-metric-trust.ts             # report, all games
 *   tsx src/scripts/audit-and-promote-metric-trust.ts --game jus_vn
 *   tsx src/scripts/audit-and-promote-metric-trust.ts --promote   # certify READY
 *   tsx src/scripts/audit-and-promote-metric-trust.ts --json
 *
 * Env: API_BASE (default http://localhost:3004), ACTOR (default $USER@vng.com.vn).
 */

import { loadGamesConfig } from '../services/games-config-loader.js';
import { canonicalGameId } from '../services/game-aliases.js';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3004';
const ACTOR = process.env.ACTOR ?? `${process.env.USER ?? 'ops'}@vng.com.vn`;
// /meta can be cold after a cube restart — give each call room and one retry.
const REQUEST_TIMEOUT_MS = 60_000;

interface CliOpts {
  game: string | null;
  promote: boolean;
  json: boolean;
}

interface Applicability {
  game: string;
  applicable: boolean;
  at?: string;
}
interface Metric {
  id: string;
  trust: 'draft' | 'certified' | 'deprecated';
  meta?: { applicability?: Applicability[] };
}
interface DriftResp {
  total: number;
  resolvable: number;
  broken: Array<{ id: string; missingRefs: string[] }>;
}
type Bucket = 'certified' | 'ready' | 'gap' | 'na' | 'deprecated';

interface GameAudit {
  gameId: string;
  status: 'ok' | 'error';
  message?: string;
  total?: number;
  counts?: Record<Bucket, number>;
  ready?: string[];
  /** GAP metrics grouped by the missing cube (the ref prefix). */
  gapByCube?: Record<string, string[]>;
  na?: string[];
  promoted?: string[];
  promoteFailed?: Array<{ id: string; reason: string }>;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { game: null, promote: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--game' && i + 1 < argv.length) opts.game = argv[++i];
    else if (a === '--promote') opts.promote = true;
    else if (a === '--json') opts.json = true;
  }
  return opts;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-cube-workspace': 'local' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await res.json()) as T & { error?: unknown };
  if (!res.ok || (body && (body as { error?: unknown }).error)) {
    throw new Error(`GET ${path} → ${res.status} ${JSON.stringify((body as { error?: unknown }).error ?? body)}`);
  }
  return body;
}

/** Latest applicability verdict for `gameId` — true unless an entry says false. */
function isApplicable(m: Metric, gameId: string): boolean {
  const entries = (m.meta?.applicability ?? []).filter(
    (e) => canonicalGameId(e.game) === canonicalGameId(gameId),
  );
  if (entries.length === 0) return true;
  const latest = entries.reduce((a, b) => ((a.at ?? '') >= (b.at ?? '') ? a : b));
  return latest.applicable;
}

/** PATCH a single metric to certified; one retry for the registry-reload 404 race. */
async function certify(id: string, gameId: string): Promise<void> {
  const body = JSON.stringify({
    trust: 'certified',
    actor: ACTOR,
    note: `refs resolve vs ${gameId} /meta; metric-trust audit rollout`,
  });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(`${API_BASE}/api/business-metrics/${id}/trust?game=${gameId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-cube-workspace': 'local' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return;
    const detail = JSON.stringify(await res.json().catch(() => ({})));
    if (res.status === 404 && attempt === 1) continue; // hot-reload race — retry once
    throw new Error(`${res.status} ${detail}`);
  }
}

async function auditGame(gameId: string, promote: boolean): Promise<GameAudit> {
  let metrics: Metric[];
  let drift: DriftResp;
  try {
    metrics = (await apiGet<{ metrics: Metric[] }>(`/api/business-metrics?game=${gameId}`)).metrics;
    drift = await apiGet<DriftResp>(`/api/business-metrics/drift?game=${gameId}`);
  } catch (err) {
    return { gameId, status: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  const brokenById = new Map(drift.broken.map((b) => [b.id, b.missingRefs]));
  const counts: Record<Bucket, number> = { certified: 0, ready: 0, gap: 0, na: 0, deprecated: 0 };
  const ready: string[] = [];
  const na: string[] = [];
  const gapByCube: Record<string, string[]> = {};

  for (const m of metrics) {
    if (m.trust === 'deprecated') {
      counts.deprecated++;
      continue;
    }
    const broken = brokenById.get(m.id);
    if (!broken) {
      // Refs resolve. Certified stays certified; a resolved draft is promotable.
      if (m.trust === 'certified') counts.certified++;
      else if (isApplicable(m, gameId)) {
        counts.ready++;
        ready.push(m.id);
      } else {
        counts.na++; // resolves but marked N/A — leave as declared
        na.push(m.id);
      }
      continue;
    }
    // Refs unresolved: a real gap if the metric is meant for this game, else N/A.
    if (isApplicable(m, gameId)) {
      counts.gap++;
      for (const ref of broken) {
        const cube = ref.split('.')[0];
        (gapByCube[cube] ??= []).push(m.id);
      }
    } else {
      counts.na++;
      na.push(m.id);
    }
  }
  // De-dup metric ids within each cube bucket (a metric can miss >1 ref per cube).
  for (const cube of Object.keys(gapByCube)) gapByCube[cube] = [...new Set(gapByCube[cube])];

  const audit: GameAudit = {
    gameId,
    status: 'ok',
    total: metrics.length,
    counts,
    ready,
    gapByCube,
    na,
  };

  if (promote && ready.length > 0) {
    audit.promoted = [];
    audit.promoteFailed = [];
    for (const id of ready) {
      try {
        await certify(id, gameId);
        audit.promoted.push(id);
      } catch (err) {
        audit.promoteFailed.push({ id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return audit;
}

function printHuman(audits: GameAudit[], promote: boolean): void {
  for (const a of audits) {
    if (a.status === 'error') {
      console.log(`\n[${a.gameId}] ERROR — ${a.message}`);
      continue;
    }
    const c = a.counts!;
    console.log(
      `\n[${a.gameId}] ${a.total} metrics — certified ${c.certified} · ready ${c.ready} · gap ${c.gap} · n/a ${c.na} · deprecated ${c.deprecated}`,
    );
    if (a.ready!.length > 0 && !promote) {
      console.log(`  READY to certify (refs resolve, declared draft): ${a.ready!.join(', ')}`);
    }
    if (a.promoted) {
      console.log(`  ✓ certified ${a.promoted.length}: ${a.promoted.join(', ') || '—'}`);
      for (const f of a.promoteFailed!) console.log(`  ✗ ${f.id}: ${f.reason}`);
    }
    const cubes = Object.keys(a.gapByCube!);
    if (cubes.length > 0) {
      console.log(`  GAP (applicable but refs unresolved) — modeling worklist:`);
      for (const cube of cubes.sort()) {
        console.log(`    missing ${cube}: ${a.gapByCube![cube].join(', ')}`);
      }
    }
  }

  // Cross-game summary.
  const ok = audits.filter((a) => a.status === 'ok');
  const sum = (k: Bucket) => ok.reduce((n, a) => n + (a.counts![k] ?? 0), 0);
  const promoted = ok.reduce((n, a) => n + (a.promoted?.length ?? 0), 0);
  console.log(
    `\n── totals across ${ok.length} games — certified ${sum('certified')} · ready ${sum('ready')} · gap ${sum('gap')} · n/a ${sum('na')}` +
      (promote ? ` · promoted ${promoted}` : ''),
  );
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = loadGamesConfig();
  const targets = (opts.game ? cfg.games.filter((g) => g.id === opts.game) : cfg.games).map(
    (g) => g.id,
  );
  if (targets.length === 0) {
    console.error(`No matching games for "${opts.game ?? '-'}"`);
    process.exit(2);
  }

  const audits: GameAudit[] = [];
  for (const g of targets) audits.push(await auditGame(g, opts.promote));

  if (opts.json) {
    console.log(JSON.stringify({ audits }, null, 2));
  } else {
    printHuman(audits, opts.promote);
  }

  process.exit(audits.some((a) => a.status === 'error') ? 1 : 0);
}

main().catch((err) => {
  console.error('audit-and-promote-metric-trust: unexpected failure', err);
  process.exit(2);
});
