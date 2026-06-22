# Answer-Quality Eval Harness

Drives each question-bank case through a real `/agent/turn` SSE call (same path as
a user click) and records what the agent resolved, answered, and did along the way.
Lives in `test/eval/`:

- `answer-quality-runner.ts` — runs the cases, writes the snapshot + per-run trail.
- `answer-quality-report.ts` — renders a snapshot JSON → Markdown report.
- `{game}-question-bank.json` — the cases (question + `expectedRef`).
- `{game}-aq-snapshot.json` — the lean, committed scorecard of record.
- `runs/` — per-run full-trail archives (gitignored; see below).

## Running

Subscription lane only, on the HOST chat-service (it holds the OAuth token; Docker
does not). `INTERNAL_SECRET` loads via `--env-file` so the secret never hits the
command line.

```
GAME=cfm_vn GROUP=synthesized-glossary PACE_MS=3000 \
  npx tsx --env-file=../.env --env-file=../.env.local \
    test/eval/answer-quality-runner.ts
```

### Env knobs

| Var | Default | Purpose |
|-----|---------|---------|
| `GAME` | `cfm_vn` | which game's bank + workspace game header |
| `GROUP` | (all) | filter to one `curationGroup` |
| `LIMIT` | ∞ | cap number of cases |
| `PACE_MS` | 2000 | inter-turn pacing (sustained back-to-back trips the session cap) |
| `CONCURRENCY` | 1 | turns in flight; raises spend rate, not the cap |
| `RESUME` | — | `1` reloads prior snapshot, keeps `ok`, re-runs the rest |
| `RESUME_KEEP` | — | extra statuses to keep on resume (e.g. `no-artifact`) |
| `TIMEOUT_MS` | 270000 | per-turn abort |
| `TRAIL` | on | `0` disables full-trail capture (lean snapshot only) |
| `RUN_DIR` | auto | override the trail archive dir for this run |

## What gets captured

### Lean snapshot (committed) — `{game}-aq-snapshot.json`
One row per case, enough to score routing + answer quality without the heavy
transcript: `status`, `httpStatus`, `resolvedRef`/`resolvedCube` vs `expectedRef`,
`artifactCount`, `nonEmpty`, `trustGuardSeen`, the final `answerText`,
`artifactTitle`, the tool-call **names** (`toolCalls`), `latencyMs`, `costUsd`,
`outputTokens`, and a `trailFile` pointer into the run archive. This is the file
the report renders and the one we commit.

### Full trail (on by default, gitignored) — `test/eval/runs/{game}-{group}-{ts}/`
Everything the turn produced, for later forensics. One timestamped dir per run so
runs accumulate a longitudinal trail instead of overwriting:

```
runs/cfm_vn-synthesized-glossary-2026-06-23T.../
├── manifest.json        # navigable index: every case → its trail file + outcome
├── snapshot.json        # frozen copy of the lean snapshot at run end
└── cases/
    ├── gloss-1.json
    ├── gloss-2.json
    └── …
```

Each `cases/{id}.json` holds:

- `rawSse` — the **verbatim** SSE stream (the complete transcription).
- `events` — every SSE frame parsed in arrival order (`{seq, type, data}`).
- `toolTrail` — each `tool_call` paired to its `tool_result`, **with arguments**:
  `{name, args, ms, resultSummary}` in call order.
- `thinkingText` — the model's reasoning (reconstructed from `thinking` deltas).
- `assistantText` — the streamed user-facing answer (reconstructed from `token`).
- plus `httpStatus`, `latencyMs`, `capturedAt`.

### One limitation
`tool_result` events carry the server-**summarised** tool output (what the FE
chip shows), not the full raw tool return — the raw return is never streamed over
SSE. Tool **arguments** are captured in full; tool **results** are the summary.
To capture full raw tool output would require server-side instrumentation in
`src/core/sse-stream.ts` (`summariseToolResult`).

## Revisiting a run for enhancement

- **Per-case deep dive:** open `runs/.../cases/{id}.json` → read `thinkingText`
  (why it chose a member), `toolTrail` (the exact cube query args it sent), and
  `assistantText` (what the user saw).
- **Across cases in a run:** `manifest.json` indexes all cases with outcome +
  trail path.
- **Across runs over time:** each run dir is self-contained (`snapshot.json`
  frozen inside it), so diffing `snapshot.json` between two run dirs shows
  answered-rate / resolution movement.

Because `runs/` is gitignored, trails live on the host that ran the eval — copy a
specific `cases/*.json` into a plan/report when a finding needs to travel.
