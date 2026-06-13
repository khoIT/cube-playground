# Facebook & AIHelp CS Tickets — Volume, Categories, and Identity-Resolution Feasibility

**Purpose:** Help readers judge whether Facebook / AIHelp support tickets (the channels currently treated as "unjoinable to a player") can be tied back to a game account, so the per-member Care surfaces can cover them.

**Method:** Live Trino queries against `iceberg.cs_ticket` (prod), 13-Jun-2026. Deep-dive sample = product 832 (jus_vn) since 2025-06-01; volume/date facts span all 78 products.

---

## 1. Headline — these are the dominant channels, not an edge case

Channel mix, `cs_ticket_info`, window **2025-01-01 → 2026-06-13** (consistent single window):

| Channel | Tickets | Share | Joinable to game uid today? |
|---|---:|---:|---|
| Facebook Directly | 976,268 | 46% | ❌ no |
| Web | 447,474 | 21% | ✅ yes (user_id = 19-digit game uid) |
| **AIHelp Facebook** | 447,192 | 21% | ❌ no |
| Ingame | 110,793 | 5% | ✅ yes |
| ZaloOA | 57,133 | 3% | ⚠️ Zalo id |
| Phone | 54,326 | 3% | ✅ yes |
| Backend / Zalo / AIHelp Web / other | ~9,800 | <1% | mixed |
| **Total** | **~2,099,977** | | |

- **Facebook + AIHelp ≈ 68% of all tickets.** Joinable channels (Ingame+Web+Phone) ≈ **29%** — so the "~10% joinable" figure carried in earlier notes is pessimistic (it reflects Ingame-only, not Web).
- **Full-history depth:** AIHelp Facebook spans **2023-05 → 2026-03** (2.36M tickets, 610K customers); Facebook Directly **2025-04 → present** (976K, 322K customers). The overlap + AIHelp's 2026-03 stop indicates a **migration from the AIHelp integration to a direct Facebook integration** — both must be handled to get continuous history.

## 2. What identity each channel actually carries

`cs_ticket_info.user_id` is **never blank**, but its meaning differs by channel (sampled, product 832):

| Channel | `user_id` content | Example |
|---|---|---|
| Web | 19-digit **game uid** | `3348871170102599680` |
| Ingame / Phone | game uid (`<uid>@...`) | `…@platform` |
| Facebook Directly | 17-digit **Facebook PSID** | `25394080796933775` |
| AIHelp Facebook | opaque **AIHelp token** | (3 of 142,490 numeric) |
| ZaloOA | Zalo user id | `2242287975114483738` |

So the naive join (`split_part(user_id,'@',1)` against segment uids) silently drops Facebook/AIHelp — their `user_id` is a channel id, not a game id.

## 3. The `customer_id` bridge — resolves 100% to a *CS customer*, but not to a *game account*

Every ticket carries `customer_id`, which joins to `customers_v2` (tier, VIP weight, social_id, login_channel, **user_id**, account_id).

**Verified facts (product 832):**

1. **`customer_id` resolves 100%** of Facebook and AIHelp tickets to a unified CS customer profile (29,202 FB + 13,041 AIHelp tickets → 0 unmatched).
2. **The bridge is the same game-uid space — proven.** For Ingame tickets (ground truth: their `user_id` *is* the game uid), `customers_v2.user_id` via `customer_id` matched the direct uid **1,761 / 1,761 = 100%, 0 mismatches**. So `customers_v2.user_id` is trustworthy as the game identity *when it exists*.
3. **But for Facebook-login players it does not exist.** All 9,801 jus_vn FB customers have exactly one `customers_v2` row, `login_channel = 27` (Facebook), `user_id = social_id = the FB PSID`, `login_info = the FB display name` ("Văn Tùng"). **Zero** carry a 19-digit game uid, and their `account_id` never appears elsewhere with a game-uid row.

**Conclusion:** within `cs_ticket` alone, Facebook/AIHelp tickets unify into a stable *CS customer* identity (good enough to thread a person's tickets across channels/time and attach sentiment/category) — **but cannot be mapped to the game's segment uid.** The only PII present is the FB id + FB display name (no phone/email/game binding).

## 4. Issue categories ("buckets") — what these tickets are about

AI `label_category` (best issue taxonomy), FB+AIHelp, product 832, since 2025-06-01:

| Category | Tickets |
|---|---:|
| (no AI label) | 19,113 |
| Gameplay | 8,002 |
| Technical | 3,782 |
| Others | 3,308 |
| Account | 3,143 |
| Event/Promotion | 2,467 |
| Payment | 2,428 |

- **6 substantive buckets** (Gameplay, Technical, Account, Event/Promotion, Payment, Others). ~45% carry no AI label yet — labeling coverage, not a data gap.
- `form_group` is **channel/region**, not issue (FACEBOOK VN / TH / PH / ID / TW, AI-HELP VN…) — useful for geo split, not issue analysis.

**Per-category read:** *Account* and *Payment* are the high-stakes buckets (security/fraud + money) where resolving the player matters most; *Gameplay* + *Event/Promotion* are the high-volume product-feedback buckets valuable in aggregate even un-attributed.

## 5. Why resolving these is worth the effort — the sentiment is here

Signal availability (since 2025-06-01, product 832):

| Channel | Tickets | Has sentiment | Has ★rating |
|---|---:|---:|---:|
| Facebook Directly | 29,202 | **97%** | 5% |
| AIHelp Facebook | 13,041 | **97%** | 19% |
| Ingame | 1,761 | 22% | 14% |

**The richest sentiment data sits in exactly the channels we currently can't attribute to a player** — Facebook/AIHelp are ~97% sentiment-scored vs 22% for Ingame. Leaving them unjoined discards the bulk of the voice-of-customer signal.

## 6. Can identity be resolved? — verdict and paths

| Path | Feasibility | Notes |
|---|---|---|
| **Web tickets** | ✅ already | `user_id` is the game uid; just include the channel. ~21% of volume, free. |
| **Thread by CS customer** (`customer_id`) | ✅ now | Unifies a person's FB+AIHelp+Web+Ingame tickets + attaches VIP tier/sentiment/category. Does **not** reach the segment uid for FB-only players, but is independently valuable. |
| **FB PSID → game account** | ❌ not in warehouse (§7) | Tested both the per-game SDK logs **and** the centralized VGA store — 0 matches. The CS Page-scoped PSID is not a key that exists anywhere in warehouse identity data. Requires an upstream Facebook Page→app-id mapping, not a warehouse join. |
| **PII match** | ❌ weak | Only FB id + display name available; no phone/email. Name-only matching is unreliable. |
| **AIHelp token → account** | ⚠️ external | Needs AIHelp's own user-mapping export; opaque token is meaningless inside `cs_ticket`. |

**Bottom line for the doc:** Facebook/AIHelp are 68% of tickets and carry 97% of the sentiment signal, but their in-ticket identity is a channel id, not a game id. `customer_id` already unifies them into a CS-customer view; tying them to the *game segment uid* requires one external join — the game's FB-social-login binding — **which does not exist in the warehouse (§7).**

## 7. The external bridge does NOT exist in the warehouse — verified

Probed `game_integration.jus_vn` for an FB-PSID → game-uid binding:

- **No social-binding table.** Identity tables are `etl_ingame_login`, `mf_users`, `map_ingame_devices_and_userid`, `map_ingame_ips_and_userid` — all keyed on game uid / VNG SDK account; **none has a Facebook column.**
- **`mf_users`** (segment uid source): `user_id` + SDK/marketing attribution only. No social/FB id field.
- **`etl_ingame_login`** (SDK login stream): identity = `account_id`/`aid`/`caid`/`urs`/`old_accountid` (VNG SDK ids); `login_channel` = only `vng_vie` (publisher channel, not a social provider). No FB PSID.
- **Cross-match (decisive):** 9,802 real CS Facebook PSIDs (ch 27) vs the union of jus_vn SDK login ids → **0 matches.**

**Why:** jus_vn authenticates via the **VNG SDK (`vng_vie`)**, so the warehouse stores a VNG account id. The CS `social_id` is a Facebook **page-scoped PSID** — by Facebook's design a per-Page id that is *not* equal to any OAuth/app id the game SDK sees. The keys are structurally different id spaces; no join exists or can be built from current warehouse data.

**Also checked — the centralized VGA credential store (`iceberg.vga`):** VGA is the cross-game identity layer (`latest_vga_external_provider_mapping` maps external provider id ↔ VGA user_id; `latest_vga_client_social_profile` holds social display_name/account_name; `std_latest_user_id_unified_pii` links VGA → ingame_user_id). Cross-matched the same 9,802 CS Facebook PSIDs against VGA's `external_provider_mapping.social_id` + `provider_id` and `client_social_profile.id` + `account_name` → **0 / 0 / 0 / 0 matches.** VGA stores the Facebook **login (app/OAuth) id**; the CS `social_id` is a Facebook **Page-scoped Messenger PSID** — a different id Facebook mints per Page. They are not the same value, so even the central store can't bridge them.

**Implication:** for jus_vn, Facebook (ch 27) and AIHelp (ch 11) tickets are **not resolvable to a game segment uid** from any data available today — not via the per-game SDK logs, not via the centralized VGA store. The blocker is fundamental: the CS Facebook integration's only machine key is a Page-scoped PSID, which exists nowhere else in the warehouse. To close it you'd need a *new* mapping sourced upstream — either (a) the Facebook Page integration capturing the game uid at conversation start, or (b) Facebook's Page→app id mapping (PSID↔ASID) obtained via the Graph API / business integration, then joined through VGA.

---

## Unresolved questions

1. ~~Does a social-login binding exist (per-game or central)?~~ **ANSWERED (§7): no — 0/9,802 PSIDs match jus_vn SDK ids; 0/9,802 match the centralized VGA store (`external_provider_mapping`, `client_social_profile`). VGA holds the FB app/login id, CS holds the Page-scoped PSID — different id spaces. No warehouse join exists.**
2. **Is the gap uniform across games?** Sample is jus_vn (832, VNG-SDK auth) only. A title that authenticates players via Facebook OAuth directly (app-scoped id stored as the account) *might* resolve — re-run §3 + §7 per product before generalizing.
3. **AIHelp token mapping** — ch 11 stores an opaque token with `social_id` EMPTY (even the PSID is absent); needs AIHelp's own user export. Or treat the AIHelp→Facebook-Directly migration (2026-03) as the path forward.
4. **`customers_v2` grain** — assumed one row per `customer_id` (held for FB sample); confirm no multi-row identity splits on account-merge games before relying on the bridge in production.
5. **Upstream capture** — cheapest real fix is likely capturing the game uid at the *Facebook Page conversation* layer going forward, rather than back-filling historical PSIDs. Needs CS-platform/SDK owner input.
