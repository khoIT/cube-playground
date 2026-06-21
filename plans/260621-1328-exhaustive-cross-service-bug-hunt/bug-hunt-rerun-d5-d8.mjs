export const meta = {
  name: 'cross-service-bug-hunt-rerun-d5-d8',
  description: 'Re-run the 4 seams dropped by the session limit: empty-range, token, SSE, FE',
  phases: [
    { title: 'Find', detail: 'finder per dropped seam (D5-D8)' },
    { title: 'Verify', detail: '3 skeptics per fresh finding, kill on majority-refute' },
    { title: 'Report', detail: 'group confirmed by severity x dimension' },
  ],
}

const REPO = '/Users/lap16299/Documents/code/cube-playground'

const DIMENSIONS = [
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
Bug shapes: HS256 secret resolution falling back silently; default-workspace fallback ('local') exposing/minting against the wrong (prod) backend; payload scoping (gameId/role/workspace missing or spoofable from header); token minted for workspace A accepted by workspace B; X-Cube-Workspace header trust without validation.`,
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

  const roundHint = round === 1
    ? ''
    : `\n\nThis is hunt round ${round}. Findings already reported (do NOT repeat): ${[...seen].slice(0, 60).join(' | ') || 'none'}. Look for DIFFERENT, deeper bugs the obvious read missed.`

  const found = (await parallel(DIMENSIONS.map((d) => () =>
    agent(d.prompt + roundHint, {
      label: `find:${d.code}:${d.label}`,
      phase: 'Find',
      schema: FINDING_SCHEMA,
    }).then((r) => (r?.findings || []).map((f) => ({ ...f, dimension: d.code, dimLabel: d.label }))),
  ))).filter(Boolean).flat()

  const fresh = found.filter((f) => !seen.has(key(f)))
  if (fresh.length === 0) { dryRounds++; log(`Round ${round}: dry (${dryRounds}/2)`); continue }
  dryRounds = 0
  fresh.forEach((f) => seen.add(key(f)))
  log(`Round ${round}: ${fresh.length} fresh findings -> verify`)

  phase('Verify')
  const judged = await parallel(fresh.map((f) => () =>
    parallel([0, 1, 2].map((i) => () =>
      agent(
        `Adversarially REFUTE this bug claim. Default refuted=true when uncertain — only refuted=false if you can trace a concrete failing path.\nFile: ${f.file}:${f.line}\nClaim: ${f.title}\nDetail: ${f.description}\nClaimed trigger: ${f.repro}\nRead the actual code first. If the trigger cannot happen (guarded elsewhere, type-impossible, dead path), refute it. If it's real, say refuted=false and note the worst-case impact.`,
        { label: `verify:${f.dimension}:skeptic${i}`, phase: 'Verify', schema: VERDICT_SCHEMA },
      ),
    )).then((vs) => {
      const v = vs.filter(Boolean)
      const realVotes = v.filter((x) => x.refuted === false).length
      return { ...f, refuted: realVotes < 2, verdicts: v }
    }),
  ))

  const survivors = judged.filter(Boolean).filter((f) => !f.refuted)
  confirmed.push(...survivors)
  log(`Round ${round}: ${survivors.length}/${fresh.length} survived verification (total confirmed=${confirmed.length})`)
}

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
