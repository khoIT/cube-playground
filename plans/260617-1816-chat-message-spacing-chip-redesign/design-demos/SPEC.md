# Design spec — Chat message redesign (spacing / padding / color + chips + terms)

You are a senior product designer working in HTML/CSS. Produce ONE self-contained
HTML file (single file, inline `<style>`, no external assets, no JS framework — a
tiny bit of plain CSS `:hover` is fine). It must open by double-click on `file://`.

## What this is
A redesign of the **chat answer thread** in an analytics product called "Cube" —
a warm, cream-paper data console. The thread shows the assistant ("CUBE") answering
data questions. Three kinds of inline rich content appear inside answer prose and
they are the whole point of this exercise:

1. **Highlighted glossary terms** — words like *Revenue*, *ARPU*, *spenders*,
   *lifetime value*, *country* are auto-decorated into small clickable pills with a
   little ⓘ / type icon. They sit INLINE inside running sentences.
2. **Mono field references** — like `mf_users.arpu_vnd`, `user_recharge_daily` —
   inline code-style tokens that name a physical column/table.
3. **Action chips** — the "next step" buttons under a clarifying question, e.g.
   `▸ Revenue`  `▸ LTV`. These are call-to-action affordances, NOT inline terms.

## The TWO problems you must solve (this is the brief)
**P1 — Wrapped inline term pills collide vertically.** Today the term pill is
`inline-flex; line-height:20px; padding:1px 6px; border:1px solid` ≈ 24px tall, but
the paragraph line box is only `1.6 × 14px ≈ 22px`. So when a sentence wraps and a
pill lands on the next row, its top border touches / overlaps the text or pill on
the row above. **Fix it:** wrapped term pills on different rows must NOT touch — they
need vertical breathing room AND must still read as a natural part of the sentence
(not as a detached row of buttons). Solve via line-height, pill height, vertical
margin, or a lighter-weight highlight treatment — your call, that's the design work.

**P2 — Action chips vs. turns aren't visually differentiated enough.** The action
chips (`▸ Revenue` `▸ LTV`) and the answer turns currently share a similar register.
Make the **action chips read clearly as primary next-step buttons** and make each
**answer turn read clearly as a distinct message block** — different visual register,
spacing, and/or container. Also: the leading `▸` arrow on action chips should be a
confident, legible size (it used to render as a faint dot).

Also reconsider overall **spacing, padding, and color** of the message blocks,
the question heading, the "Reasoning" disclosure row, the timestamp, and the
relationship between a user question and the CUBE answer beneath it.

## Content to reproduce (use this EXACT content — three turns)
**Turn 1**
- User heading: **Top 20 VIP players**  ·  timestamp "4 hours ago"
- CUBE · 14:40  ·  a "⊙ Reasoning ›" collapsed disclosure row
- Answer prose: "Ranking individual players — which metric should I rank the top 20 VIP players by?"
- A faint repeat of the prompt (muted): "Ranking individual players — which metric should I rank the top 20 VIP players by?"
- Action chips: `▸ Revenue`  `▸ LTV`

**Turn 2** (THIS turn is where term pills wrap and collide — make it the showcase)
- User heading: **Rank the top 20 players by ARPU**  ·  "4 hours ago"
- CUBE · 14:40 · "⊙ Reasoning ›"
- Bulleted answer (terms in [brackets] are glossary pills, `mono` are field refs):
  - "[Revenue] — each player's total recharge amount (the numerator of [ARPU], per person). This is what most "top [spenders]" leaderboards use."
  - "**LTV** — each player's [lifetime value], which captures cumulative spend across their entire history."
- Prompt (muted): "Which per-player metric should I rank the top 20 players by instead?"
- Action chips: `▸ Revenue`  `▸ LTV`

**Turn 3**
- User heading: **Top 10 countries by ARPU last 30 days** · "4 hours ago"
- CUBE · 14:41 · "⊙ Reasoning ›"
- Prose: "Only 5 distinct countries exist in this game's user base — no "top 10" to fill. A few things to note:"
- Bullets:
  - "**OT (~362K VND)** — the "Other" catch-all code, anomalously high; likely test accounts or VPN-routed users, not a real market."
  - "**VN (~43,323 VND)** — the primary market, as expected for CFM VN."
  - "**PH & ID** — registered users but zero [ARPU]; no paying activity."
- Para: "**Why "last 30 days" didn't apply:** `mf_users.arpu_vnd` lives in `mf_users`, a per-user snapshot with no date dimension. The number reflects **lifetime** ARPU, not a rolling 30-day window."
- Para: "For a true **30-day ARPU by** [country], I'd need to query `user_recharge_daily` (which has a daily date dimension) joined to `mf_users.country`. Want me to run that instead?"
- A chart-card stub at the bottom: "📊 Lifetime ARPU by Country" with a right-aligned "Raw Query" link + a "Bar ⌄" select.

At the very bottom, a composer input card: "What do you want to know?" with two
toggles (Web Search, DeepThink), a "Bypass cache" chip, and a circular send button.

## Design tokens — USE THESE, do not invent colors (light "cream" theme)
```
--bg-app / page:        #f8efe5   (warm cream — the page background)
--bg-card / surface:    #f8efe5   (cards share the cream; separate via border/shadow not fill)
--bg-muted:             #efe3d4
--surface-subtle:       #f9fafb
--text-primary:         #171717
--text-secondary:       #404040
--text-emphasis:        #262626
--text-subtle:          #737373   (timestamps, muted prompt echo)
--brand:                #f05a22   (orange — THE accent)
--brand-hover:          #c2410c   (orange-700-ish)
--brand-soft:           #fff7ed   (soft orange fill)
--brand-border:         #fed7aa
--info-soft:            #dbeafe   --info-ink: #1d4ed8   (alt term tone if you want type-coloring)
--border:               #e5e5e5
--border-strong:        #d4d4d4
--success-soft:#ecfdf5 --success-ink:#047857   --destructive-soft:#fee2e2 --destructive-ink:#991b1b
--radius-xs:4 --radius-sm:6 --radius-md:8 --radius-lg:10 --radius-card:12 --radius-pill:9999px
font sans: 'Inter', -apple-system, system-ui, sans-serif
font mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace
```
Spacing scale (reuse, don't invent): 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 / 32 / 48.
Body prose: 14px / line-height ~1.6. Headings: question = ~20px/700.

## Hard rules
- ONE font family for everything (Inter). No serif, no display fonts.
- Orange is the only accent. No purple/teal/gradient slop.
- Cards sit on cream; separate with border + subtle shadow, not a different fill.
- Show a `:hover` state for both term pills and action chips.
- The page should look like a polished, shippable product surface — not a wireframe.
- Put a small fixed label in the top-left: the variation name + a one-line note on
  the spacing/term/chip decisions you made (so the reviewer can tell the 3 apart).
- 1440px-ish content, centered, max-width ~860px for the thread column.

## Output
Write the file to the EXACT path given in your task. Single self-contained .html.
