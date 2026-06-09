---
phase: 1
title: "MCP-headless spike (gating)"
status: complete
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: MCP-headless spike (gating)

## Overview
Prove (or disprove) that a backend-spawned `claude -p --dangerously-skip-permissions` child process can reach the user's claude.ai Atlassian + Microsoft 365 MCP connectors and fetch the Tesseract Confluence page. This is the single biggest project risk and **gates all later phases**. Outcome = a recorded go/no-go + the exact, repeatable invocation recipe (or the fallback decision).

## Requirements
- Functional: a spawned non-interactive `claude` invocation lists Atlassian + M365 MCP tools and successfully fetches Confluence page `1609334800` (Tesseract Architecture target v0.2) and runs one Outlook email search.
- Non-functional: invocation is deterministic and scriptable from a Node child process (no TTY prompts); captures structured stream-json output.

## Architecture
- Probe = a thin shell/node script that runs `claude -p "<probe prompt>" --dangerously-skip-permissions --output-format stream-json` with cwd at repo root, and parses stdout for: (a) `mcp__claude_ai_Atlassian__*` tool availability, (b) a successful Confluence fetch result, (c) a successful email search.
- Decision matrix recorded in `spike-findings.md`:
  - **PASS** → lock the invocation recipe (flags, env, cwd, MCP config path) as the contract Phase 3 implements.
  - **FAIL (MCP absent in headless)** → trigger fallback: direct Confluence REST (`/wiki/api/v2/pages/{id}`) + Microsoft Graph (`/me/messages?$search=`) with tokens in `.env`. Only Phase 5 inputs change; Phases 2-4,6-8 unaffected.

## Related Code Files
- Create: `../cube-advisor/spikes/probe-mcp-headless.mjs` (throwaway probe; not shipped)
- Create: `../cube-advisor/spikes/spike-findings.md` (decision record)
- Read: `~/.claude.json` (confirm connector tokens cached — do NOT print secrets)

## TDD — Tests First
This phase is empirical, so the "test" is an executable assertion script:
1. Write `probe-mcp-headless.mjs` that asserts, with non-zero exit on failure:
   - stream-json contains an Atlassian MCP tool-use event, AND
   - the Confluence fetch result contains a non-empty Tesseract page title/body, AND
   - the Outlook search returns ≥0 results without an auth error.
2. Run it. The probe IS the regression check for the chosen recipe.

## Implementation Steps
1. Confirm `claude --version` and that the claude.ai Atlassian + M365 connectors are authenticated (run `claude mcp list` or equivalent; note any per-scope config).
2. Author the probe prompt: "List your available MCP tools. Then fetch Confluence page id 1609334800 and return its title. Then search Outlook for 'Tesseract' and return subject lines. Emit results as JSON."
3. Run the probe via Node `child_process.spawn` (not just a terminal) to mimic the real backend spawn — this is the part most likely to differ from interactive.
4. Capture: does MCP load? what `--mcp-config` / env (if any) was needed? latency? token cost?
5. Record PASS/FAIL + recipe (or fallback decision) in `spike-findings.md`.
6. If FAIL: spike the fallback minimally — one authenticated Confluence REST GET + one Graph search — to confirm the alternate path is viable before committing.

## Success Criteria
- [ ] `probe-mcp-headless.mjs` exits 0 on the chosen path (MCP or fallback)
- [ ] Tesseract page content retrieved and shown
- [ ] `spike-findings.md` records the exact invocation recipe (flags/env/cwd) OR the fallback decision with rationale
- [ ] Go/no-go decision communicated; Phases 3 & 5 contracts updated to match the proven recipe

## Risk Assessment
- **Primary risk:** MCP connectors may not load in non-interactive spawn → mitigated by the fallback path, scoped and pre-validated here.
- Secondary: spawn from Node may behave differently than terminal → step 3 explicitly tests via `child_process`, not a shell the user typed into.
- Do not leak tokens in logs/findings.

## Red Team Hardening (applied)
- **This is a SPIKE/EVAL, not TDD** — the deliverable is a recorded judgment (`spike-findings.md`), not green unit tests. The probe script is the assertion; "tests-first" is relabeled accordingly.
- **Test BOTH transports** (#6): probe via the **Agent SDK** (programmatic, used by cube-playground `claude-runner.ts:166`) *and* the `claude -p` CLI, and record which inherits the user's claude.ai MCP connectors. Prefer whichever works at **least privilege** — i.e. with an explicit read-only/allowlisted tool set rather than blanket `--dangerously-skip-permissions`. If MCP works without the blanket bypass, finding #2's blast radius collapses; record that explicitly.
- **Per-connector pre-flight** (#11): probe must enumerate `claude mcp list` state for EVERY connector the product category needs (Atlassian, M365, and the VNGGames data connectors GDS/VDA — currently "Needs authentication"), not just Atlassian+Outlook. Record which are dead and whether a REST fallback is required per-connector.
- **Measure a representative run, not just a probe** (#10): record wall-clock + `total_cost_usd` for a *small but real* idea-generation run (not only a tool-list/page-fetch). Probes already measured ~$0.62–$1.02 each; this number sets the Phase 3 timeout + per-run budget ceiling. Do NOT hard-code 15 min before measuring.
- **Injection note** (#2): treat fetched Confluence/email as untrusted input even in the spike; never have the probe print `~/.claude.json` or token material.
