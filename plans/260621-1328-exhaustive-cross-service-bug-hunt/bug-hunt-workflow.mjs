export const meta = {
  name: 'cross-service-bug-hunt',
  description: 'Loop-until-dry bug hunt across chat-service/server/cube-dev/FE with adversarial verification',
  phases: [
    { title: 'Find', detail: 'one finder per seam dimension, blind to each other' },
    { title: 'Verify', detail: '3 skeptics per fresh finding, kill on majority-refute' },
    { title: 'Report', detail: 'group confirmed findings by severity x dimension' },
  ],
}

const REPO = '/Users/lap16299/Documents/code/cube-playground'

// Each dimension = one seam. `prompt` is the finder brief; `code` is the dedup/label key.
const DIMENSIONS = [
  {
    code: 'D1', label: 'auth-lane-failover',
    prompt: `Hunt for real, reproducible bugs in the Anthropic key-failover / auth-lane code.
Read: ${REPO}/chat-service/src/core/anthropic-key-failover.ts, llm-auth-mode.ts; ${REPO}/chat-service/src/api/internal-llm-auth.ts; ${REPO}/chat-service/src/core/claude-runner.ts; ${REPO}/server/src/services/chat-llm-auth-client.ts.
Bug shapes: key-rotation race; cooldown-expiry off-by-one; mode-gate ('auto'/'gateway'/'subscription') filtering rotation to empty; OAuth-token (CLAUDE_CODE_OAUTH_TOKEN / subscription) path correctness; isBalanceExhaustedError mis-classification (false negative leaves a dead key active); the case where all keys share one drained upstream.`,
  },
  {
    code: 'D2', label: 'tokenless-members-movement',
    prompt: `Hunt for real bugs in the tokenless segment members + movement read APIs.
Read: ${REPO}/server/src/routes/segments.ts (GET /:id/members ~L657, guardSegment ~L195), ${REPO}/server/src/routes/segment-movement.ts (kpi-trend, movement, state-distribution, state-distribution-trend); ${REPO}/server/src/services/member-profile-runner.ts, member360-runner.ts, member-profile-on-demand.ts.
Bug shapes: auth/visibility check running AFTER data load (info leak); guardSegment ordering / IDOR via :id; rank-measure injection from segment definition; enrichment cache staleness served as fresh on a tokenless tier; missing scope on game/owner.`,
  },
  {
    code: 'D3', label: 'cube-proxy-abort',
    prompt: `Hunt for real bugs in the Cube proxy abort/disconnect + load path.
Read: ${REPO}/server/src/routes/cube-proxy.ts (L165-414, esp. makeClientAbortController L246-264), cube-load-admission.ts, cube-load-result-cache.ts.
Bug shapes: reply.raw vs req.raw close-event wiring (req.raw 'close' fires when body read, too early for POST /load -> false abort); writableFinished guard correctness; continue-wait poller 499-on-disconnect path; admission-control orphan-query abort; load-result-cache key collisions across workspace/game; LRU eviction + TTL interaction; realtime-skip logic.`,
  },
  {
    code: 'D4', label: 'cache-layers',
    prompt: `Hunt for real bugs across cache layers in BOTH services.
Read: ${REPO}/chat-service/src/cache/*.ts (response-cache-key.ts, response-cache-write.ts, load-cache-adapter.ts, turn-detail-cache-adapter.ts, kv-cache-store.ts, session-focus-adapter.ts, user-prefs-adapter.ts); ${REPO}/server/src/services/*-cache-store.ts (member360, dashboard-tile, segment-care); ${REPO}/server/src/routes/cube-load-result-cache.ts.
Bug shapes: cache key missing owner/model/workspace/game -> cross-tenant or cross-model leak; TTL vs eviction races; missing invalidation when a new Trino partition lands; unbounded growth / no max-size; stale-on-write.`,
  },
  {
    code: 'D5', label: 'empty-range-reanchor',
    prompt: `Hunt for real bugs in chat empty-range re-anchoring.
Read: ${REPO}/chat-service/src/services/resolve-coverage-range.ts (resolveCoverageLatest, snapWindow, isRelativeRange, rangeWidthDays), load-cube-rows.ts; ${REPO}/chat-service/src/tools/disambiguate-starter-passthrough.ts, preview-cube-query.ts, emit-query-artifact.ts.
Bug shapes: relative-vs-explicit range mis-detection (explicit ranges must NOT be re-anchored); snap-window math at month/year boundaries / DST; per-member cache key wrong; probe-failure fallback wrong; disclosure flag not set when re-anchored; width computed off-by-one.`,
  },
  {
    code: 'D6', label: 'cube-token-workspace',
    prompt: `Hunt for real bugs in Cube token minting + workspace routing.
Read: ${REPO}/server/src/routes/cube-token.ts, ${REPO}/server/src/services/sign-cube-token.ts, resolve-cube-token.ts; ${REPO}/server/src/middleware/workspace-header.ts (getDefaultWorkspace L79, plugin L78-143).
Bug shapes: HS256 secret resolution falling back silently; default-workspace fallback ('local') exposing/мinting against the wrong (prod) backend; payload scoping (gameId/role/workspace missing or spoofable from header); token minted for workspace A accepted by workspace B; X-Cube-Workspace header trust without validation.`,
  },
  {
    code: 'D7', label: 'sse-registry-recorder-edge',
    prompt: `Hunt for real bugs in the SSE per-turn stream registry + recorder-edge field stripping.
Read: ${REPO}/chat-service/src/api/turn.ts (emit L186-197, onTurnFinalized L710), ${REPO}/chat-service/src/core/sse-stream.ts, stream-registry.ts; ${REPO}/chat-service/src/api/turn/build-observer.ts; ${REPO}/chat-service/src/observability/sinks/.
Bug shapes: recorder-only fields (internal IDs, trace spans, timing) leaking onto the SSE wire; ring-buffer overflow dropping events a reconnecting client needs; abort-reason not propagated to client; turnId collision across sessions; replay/reconnect event gaps; emit() after stream closed.`,
  },
  {
    code: 'D8', label: 'fe-streaming-parity',
    prompt: `Hunt for real bugs in the FE streaming + proxy contract.
Read the SPA chat streaming store (zustand) and SSE consumer under ${REPO}/src/ (search for the chat stream store, SSE EventSource/fetch-stream reader, and the docked chat panel vs main /chat surface). Also the /build deep-link 'query' param decode.
Bug shapes: abort-on-unmount not firing (leaked stream); SSE parse desync on multi-line data; docked-panel vs main-/chat feature parity gaps (follow-up chips / refine row gate); deep-link query JSON injection / unvalidated parse; state not reset between turns.`,
  },
  {
    code: 'D9', label: 'cube-model-correctness', model: 'sonnet',
    prompt: `Audit cube-dev YAML models for correctness bugs. Read-only — do NOT edit YAML.
Read representative cubes under ${REPO}/cube-dev/cube/model/cubes/{game}/*.yml (cfm_vn, jus_vn at minimum) and their rollup pre-agg defs.
Bug shapes (verify by reasoning over the YAML + compiled SQL semantics, not by skeptic panel): non-additive measure (countDistinct/avg/ratio) placed in an additive rollup; rollup time-dimension that does not match the query time-dimension (e.g. log_date vs dteventtime); PK fan-out from a non-unique join key (transid-style); build_range_end cap missing or wrong; measures referenced by metrics that exist in no cube model.
Report each as a finding with the exact file:line and the SQL-level reason it is wrong.`,
  },
]

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          title: { type: 'string' },
          description: { type: 'string' },
          repro: { type: 'string', description: 'concrete trigger / interleaving; required' },
          severity: { type: 'string', enum: ['crit', 'high', 'med', 'low'] },
          impact: { type: 'string' },
        },
        required: ['file', 'line', 'title', 'description', 'repro', 'severity', 'impact'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    missedFailureMode: { type: 'string' },
  },
  required: ['refuted', 'reason'],
}

const key = (f) => `${f.file}:${f.line}:${f.title}`.toLowerCase()
const seen = new Set()
const confirmed = []
let dryRounds = 0
let round = 0

while (dryRounds < 2 && (!budget.total || budget.remaining() > 60_000)) {
  round++
  phase('Find')
  log(`Round ${round}: ${DIMENSIONS.length} finders (seen=${seen.size}, confirmed=${confirmed.length})`)

  // Vary the brief per round so finders don't repeat themselves.
  const roundHint = round === 1
    ? ''
    : `\n\nThis is hunt round ${round}. Findings already reported (do NOT repeat): ${[...seen].slice(0, 60).join(' | ') || 'none'}. Look for DIFFERENT, deeper bugs — edge cases, error paths, concurrency, and interactions the obvious read missed.`

  const found = (await parallel(DIMENSIONS.map((d) => () =>
    agent(d.prompt + roundHint, {
      label: `find:${d.code}:${d.label}`,
      phase: 'Find',
      schema: FINDING_SCHEMA,
      ...(d.model ? { model: d.model } : {}),
    }).then((r) => (r?.findings || []).map((f) => ({ ...f, dimension: d.code, dimLabel: d.label, isModel: d.code === 'D9' }))),
  ))).filter(Boolean).flat()

  const fresh = found.filter((f) => !seen.has(key(f)))
  if (fresh.length === 0) { dryRounds++; log(`Round ${round}: dry (${dryRounds}/2)`); continue }
  dryRounds = 0
  fresh.forEach((f) => seen.add(key(f)))
  log(`Round ${round}: ${fresh.length} fresh findings -> verify`)

  phase('Verify')
  const judged = await parallel(fresh.map((f) => () => {
    // D9 (model correctness) is verified by a single SQL-reasoning check, not a refute panel.
    if (f.isModel) {
      return agent(
        `Verify this Cube model finding by reasoning over the YAML + compiled-SQL semantics. Is it a REAL correctness bug? File ${f.file}:${f.line} — "${f.title}". ${f.description}. Trigger: ${f.repro}. Read the file. Set refuted=true if the YAML is actually correct.`,
        { label: `verify:${f.dimension}:model`, phase: 'Verify', schema: VERDICT_SCHEMA },
      ).then((v) => ({ ...f, refuted: v?.refuted !== false, verdicts: [v].filter(Boolean) }))
    }
    return parallel([0, 1, 2].map((i) => () =>
      agent(
        `Adversarially REFUTE this bug claim. Default refuted=true when uncertain — only refuted=false if you can trace a concrete failing path.\nFile: ${f.file}:${f.line}\nClaim: ${f.title}\nDetail: ${f.description}\nClaimed trigger: ${f.repro}\nRead the actual code first. If the trigger cannot happen (guarded elsewhere, type-impossible, dead path), refute it. If it's real, say refuted=false and note the worst-case impact.`,
        { label: `verify:${f.dimension}:skeptic${i}`, phase: 'Verify', schema: VERDICT_SCHEMA },
      ),
    )).then((vs) => {
      const v = vs.filter(Boolean)
      const realVotes = v.filter((x) => x.refuted === false).length
      return { ...f, refuted: realVotes < 2, verdicts: v }
    })
  }))

  const survivors = judged.filter(Boolean).filter((f) => !f.refuted)
  confirmed.push(...survivors)
  log(`Round ${round}: ${survivors.length}/${fresh.length} survived verification (total confirmed=${confirmed.length})`)
}

// Order: severity then dimension.
const sevRank = { crit: 0, high: 1, med: 2, low: 3 }
confirmed.sort((a, b) => (sevRank[a.severity] - sevRank[b.severity]) || a.dimension.localeCompare(b.dimension))

phase('Report')
const byDim = {}
for (const f of confirmed) (byDim[f.dimension] ||= []).push(f)

return {
  rounds: round,
  totalFresh: seen.size,
  confirmedCount: confirmed.length,
  bySeverity: confirmed.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {}),
  byDimension: Object.fromEntries(Object.entries(byDim).map(([k, v]) => [k, v.length])),
  findings: confirmed,
}
