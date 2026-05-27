# Dev server logs

Captured combined output of `npm run dev:all` (vite + segments-server + chat-service + cube watchdog) for **daily triage**.

## Policy

- **File:** `logs/dev-all.log` — single rolling file, all four processes interleaved, each line prefixed with an ISO-8601 UTC timestamp.
- **Retention:** last **3 hours** only. Older lines are pruned on `dev:all` startup and every 5 minutes while it runs. Keeps the file small enough to read whole.
- **Tracked vs ignored:** this README is committed; `*.log` files are gitignored (may contain raw payloads / tokens).
- **Capture:** `scripts/dev-log-capture.mjs`, wired into `scripts/dev-all.mjs`. Terminal output is unaffected (colour preserved); the file copy is ANSI-stripped.

## For the agent / daily review

When asked to "check the server logs", read `logs/dev-all.log` and:

1. Group repeated errors by root cause (don't list every occurrence).
2. Rank by **business-user impact**, not raw frequency — a certified/tier-1 metric or a user-facing 500 outranks a noisy draft-tier warning.
3. Cite `file:line` for each root cause and propose the narrowest fix.

If the file is missing or empty, `dev:all` likely isn't running — say so rather than guessing.
