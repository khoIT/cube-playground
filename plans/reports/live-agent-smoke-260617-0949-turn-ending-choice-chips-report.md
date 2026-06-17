# Live agent smoke — turn-ending choice chips

Date: 2026-06-17 (GMT+7). Lane: running dev FE :3000 + chat-service :3005, game ballistar.
Method: Playwright drove the real /chat page (auth-disabled = bootstrap admin), sent a
prompt designed to make the agent end the turn asking the user to pick a direction.

## Prompt
"I want to dig into what is driving monetization in ballistar. Give me a few specific
directions I could investigate, and let me pick one to start with."

## Result — PASS

**Agent reliably calls `offer_choices`** — 4/4 independent runs ended with a
`disambig_options` frame, `slot="choice"`, 4–5 chips. Sample chip sets:
- run A: Revenue decomposition / IAP vs Web split / Whale concentration / Product mix / At-risk payer exposure
- run D: Revenue trend / IAP vs Web split / New payer reliance / Marketing efficiency

**Rendering** — chips render with the brand action style (soft orange fill + brand
border + ▸ marker). Inline glossary terms in the answer show the chat-only brand
recolor (orange pills). `followup-chips` NOT present → precedence gate works live.
(visuals/live-smoke-turn1.png)

**Click → auto-send** — clicking the first chip fires a brand-new POST to the turn
endpoint carrying the option's pinText verbatim:
  "Show me daily total revenue for ballistar over the last 90 days as a time series,
   so I can spot growth, decline, or inflection points."
A self-contained, fully-resolved instruction (metric + window + intent) — exactly the
pinText contract. Next turn streams normally. (visuals/live-smoke-turn2.png)

## Note (not a regression)
First click attempt was dropped because it landed before the FE flipped
`isStreaming`→false (chips can paint a beat before stream finalises). `handleDisambigPick`
guards `if (!trimmed || isStreaming) return` — shared with engine-disambig + followup
chips, not new to this feature. After a ~2s settle the click auto-sends every time.
Low-severity UX edge; only matters if a user clicks within ~1s of the answer painting.

## Unresolved questions
- Should the choice-chip set collapse / disable after a pick (currently re-clickable,
  consistent with engine disambig)? Product call.
- Optional: relax the `isStreaming` guard for chip clicks so an instant click queues
  instead of dropping — minor, defer unless observed in real use.
