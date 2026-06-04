# Phase 04 — Reassign Legacy 'dev' Chats

**Priority:** P1 · **Status:** pending · **Independent (ops)**

## Why
On `:11000` all existing chats were created under owner `'dev'`. After Phase 01, real users
(claims.sub) no longer match `'dev'` → those chats vanish from everyone's list. User chose to
**reassign** them to a real owner so they stay visible to that person.

## Script: `chat-service/scripts/reassign-owner.mjs`
- Args: `--from <oldOwner=dev> --to <sub> [--label <name>] [--game <id>] [--db <path>]`.
- Opens the chat-service SQLite DB (default from `CHAT_DB_PATH`/config), runs:
  `UPDATE chat_sessions SET owner_id=?, owner_label=COALESCE(?, owner_label) WHERE owner_id=? [AND game_id=?]`.
- Dry-run by default (prints count); `--apply` to commit. Writes a fresh snapshot after apply.
- Prints affected session ids.

## Getting the target `sub`
- The operator finds their Keycloak `sub` from `/api/auth/me` (or decoding the app JWT). No UUID
  is hardcoded in the script or repo.

## Success criteria
- `--from dev --to <sub> --apply` → those sessions list for that user post-login; not for others.
- Re-running is idempotent (no rows left with owner `'dev'` after first apply).

## Risks
- Run against the correct DB volume on `:11000` (docker). Document the path in deployment notes.
