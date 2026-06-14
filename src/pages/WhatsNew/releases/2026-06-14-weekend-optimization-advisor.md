---
id: weekend-optimization-advisor
title: A big weekend — from data explorer to optimization advisor
date: 2026-06-14
kind: new
area: Platform
image: /whats-new/weekend-optimization-advisor.svg
---
Two days, one direction: cube-playground is growing past *"ask the data a
question"* into a workspace that tells you **what to do about the answer**. Here's
everything that landed since Friday.

**💳 CS + payment billing, wired into the model**

- New cross-cutting cubes — **billing detail, lifetime billing, CS tickets and
  identity** — now sit alongside the per-game cubes for cfm_vn and jus_vn, gated
  to the right product and joined on the verified identity keys.
- They show up in the [Catalog](/catalog) join graph like any other cube, and a
  new **Ops** tab on a member's [360 view](/segments) pulls their payment and
  identity facts into one panel.

**🎧 A real Care center, per player**

- Every whale [segment](/segments) gets a **Care** tab backed by *real* CS
  tickets — the in-game and web support channels (the ones whose IDs resolve to a
  game account), not Facebook.
- Each member opens into a **Care History 360**: full ticket timeline with AI
  labels and sentiment, a readable transcript with auto-reply / reopen markers,
  and downloadable attachments.

**🎯 The direction: an optimization advisor center**

- We scoped the **Experiment Command Center** — a CS-actuated closed-loop A/B
  platform that rides the surfaces above: pick a cohort, hash-split it, hand the
  treatment arm to CS as a work queue, then score lift on live billing. First
  target: lapsing high-LTV payer win-back. *(Designed this weekend; building next.)*

**⚙️ And a lot more under the hood**

- A **canonical cube generator** rolled a consistent model out to all 8 games.
- **Pre-aggregation readiness matrix** with on-demand rollup builds, so cohorts
  refresh fast and you can see exactly what's sealed.
- **Nightly segment-membership snapshots** to the lakehouse, with live run status.
- In-game **player names** synthesized onto members, a per-game [/ops](/ops)
  payment + identity console, auto-running [playground](/build) deep links, and
  per-turn query cards on the chat audit views.

The bell up top will badge new releases as they land.
