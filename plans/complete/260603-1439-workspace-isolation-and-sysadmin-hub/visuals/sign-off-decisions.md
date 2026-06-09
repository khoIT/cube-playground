# Sign-off decisions — Phase 5 huashu hi-fi prototype

Source artifact: `visuals/index.html` (interactive, 3 layout variants via Tweaks).
Signed off 2026-06-03. Throwaway prototype — not code; React port reconciles to `tokens.css`.

## Approved direction

- **Per-user panel layout = Variant B · Two-column.**
  Summary header full-width → role/status + workspace grants + game grants in the
  left column, feature access + activity snapshot in the right column.
  Screenshot of record: `hub-access-twocol.png`.

- **Chat-Audit tab scoping = cross-user (any user).** ⚠ Scope expansion (user-confirmed):
  the existing DevAudit surface is `X-Owner-Id` self-scoped (admin sees only own
  chats). Cross-user view requires backend scoping changes — NOT a pure relocation.
  Fold the admin-scoped audit read into Phase 5.

## Affordance vocabulary locked by the prototype

- **Switch-ability** is surfaced whenever >1 workspace is granted: a `✓ can switch`
  callout (`--success-soft/-ink`) under the workspace grant matrix + a Workspaces stat
  in the summary header. Exactly 1 workspace → switcher hidden, muted note. 0 → muted
  "can't load cube data" note.
- **Game grants** show a live `N of M` count (header + summary stat).
- **Feature toggles** grouped into two areas: *Analyst surfaces* (default-on) and
  *Admin / governance* (`admin`, default-off). An explicit per-user entry renders an
  `override` badge (`--info-soft/-ink`); absent entries fall back to the group default
  for `active` users (mirrors feature-keys.ts policy).
- **Activity snapshot** is read-only this phase, ribboned `wired Phase 6/7`. Binds the
  shipped `UserActivity` shape: chat turns (null → "chat-service unreachable"),
  inactive>30d status, recent features, recent query shapes (member NAMES only — privacy
  note shown), segment count.
- **Observability tab** = Phase-7 placeholder (renders the already-shipped
  activity-aggregator summary later).

## Design-system reconciliation rules for the React port

- Hub tab shell GENERALIZES the existing DevAudit ARIA tablist (`role=tablist`, arrow/
  Home/End nav, `aria-selected`, roving `tabIndex`) — do not author a new shell.
- Relocated DevAudit surfaces migrate off the legacy `T`/`shell/theme` token object onto
  `tokens.css` (no two-token-system drift).
- Every color/radius/font references a `tokens.css` variable. Header matches the
  Dashboards/Access pattern (24px 32px padding, 1200 maxWidth, eyebrow + 20px/700 title).

## Open question carried into implementation

- Cross-user chat-audit: which server route exposes another user's sessions, and does
  chat-service `/internal/stats` (sub-keyed, shipped Phase 3/4) already cover the read,
  or is a new admin-scoped sessions endpoint needed? Resolve during scout.
