# GDS Data Platform — Data Flow: Current State vs Vision (v11)

**Date:** 2026-06-16 (GMT+7)
**Sources:** metadata.gds.vng.vn live schema (Trino `game_integration` + ClickHouse CDP) · Confluence GDS (Platform Architecture Overview `920551716`, CDP Architecture & Components `911409176`, Medallion model) · vision diagram `operational_analytics_architecture_v11-20260603-150528.svg`.
**Purpose:** one picture of how data moves + where it lands + which engine serves which use case, so we can reason about merging/combining toward the v11 vision.

---

## 1. The platform is Medallion (5 layers) on a Lakehouse

Confluence canon (`920551716`). The Trino `game_integration` prefixes map **exactly** onto the medallion layers:

| Medallion layer | Meaning | Trino prefix (verified) | Also lands in |
|---|---|---|---|
| Source | SDKs/tracking (VNG SDK, AppsFlyer, Firebase, VGA, Pay, Reward, Promo) | — | Kafka |
| Landing (Raw) | as-is, warm storage | — | MinIO/HDFS |
| **Bronze (ETL)** | parsed/typed; **realtime dashboards built in ClickHouse** | `etl_ingame_*` | ClickHouse |
| **Silver (STD)** | cleaned, normalized, joined | `std_ingame_*` | — |
| **Gold (CONS)** | business metrics (DAU/ARPU/retention) | `cons_*` | — |
| Serving | APIs / dashboards / CDP feeds | `mf_*`, `map_*`, views | ClickHouse, Mongo, Trino |

Stack: Kubernetes · MinIO · Iceberg · Spark · **Trino + ClickHouse** · Airflow · Vault.

---

## 2. The key insight: ONE source, TWO lanes

Your mental model ("Trino has etl_+serving in one place; Kafka only via CDP") is **~80% right**. The precise picture: the same game events fork into a **batch lane** and a **realtime lane**, and Kafka is the *shared ingestion bus*, not CDP-only.

```
                         ┌────────────────────── GAME / BUSINESS SOURCES ──────────────────────┐
                         │ in-game SDK logs · AppsFlyer · Firebase · VGA(MySQL) · Pay · Reward  │
                         │ Promo · PII                                                          │
                         └───────────────┬───────────────────────────────┬─────────────────────┘
                                         │                               │
                      game logs (GIO)    │                               │  CDC (Debezium) + SDK stream
                      daily batch, T-1    │                               │  near real-time
                                         ▼                               ▼
                ┌──────────────────────────────────┐          ┌────────────────────────────────┐
                │  BATCH LANE  (DA team · Airflow)   │          │  REALTIME LANE  (Spark Streaming)│
                │  Spark parse → Medallion           │          │  consume Kafka topics directly   │
                │                                    │          │  (e.g. kafka-gio.jus_vn-realtime)│
                │  MinIO/Iceberg  →  Trino            │          │                                  │
                │  game_integration.<game>:          │          │  ClickHouse CDP (gio-clickhouse- │
                │   etl_*  std_*  cons_*  mf_* map_* │          │   cdp): masterfile_*, role_active│
                │                                    │          │  + Apollo (live segments)        │
                │                                    │          │  + Mongo (billing model)         │
                └───────────────┬────────────────────┘          └───────────────┬────────────────┘
                                │  clean batch data                              │ realtime profiles/segments
                                ▼                                                ▼
                ┌──────────────────────────────┐                 ┌────────────────────────────────┐
                │ ANALYTICS / PAST-SEGMENT       │                 │ ACTIVATION / LIVE              │
                │ Cube (our cube-dev) · Metabase │                 │ Apollo Interface · CleverTap · │
                │ · Superset · Jupyter           │                 │ AppsFlyer Audiences · CSKH     │
                │ → MCP → AI Chat (cube-playground)│               │ → campaigns / triggers         │
                └──────────────────────────────┘                 └────────────────────────────────┘

   OpenMetadata (metadata.gds.vng.vn): crawls schema+samples from BOTH Kafka & Trino/ClickHouse;
   governs lineage/ownership/classification; publishes the catalog (dataProducts) consumed above.
```

**Corrections to the "Kafka only via CDP" model (verified by freshness probe 2026-06-16 16:25 GMT+7):**
- Kafka is the **shared bus** for *all* streaming sources (in-game SDK, plus Debezium CDC from VGA/Pay/Reward/Promo MySQL+Mongo). The realtime lane (CDP/ClickHouse/Apollo) consumes it directly.
- **Trino `game_integration` is NOT a pure T-1 batch warehouse** (corrects an earlier draft). Its `etl_ingame_*` tables run at **mixed cadence**, proven empirically by `max(log_date)`/`max(updated_time)`:
  - **Streaming / near-RT** (`login`, `logout`, `register`, `npc_im_tour`, `garden_crop`): log_date = today, written ~minutes ago → continuous ingestion into Iceberg/Trino, almost certainly **Kafka→Spark→Iceberg** (matches `layouts/rt/etl/…` convention + `gio-default/*-login` Kafka topics in the ingestion-mapping doc). *Not yet doc-confirmed at the exact topic→table lineage level.*
  - **Daily batch T-1** (`recharge`, `ccu`): log_date = yesterday, refreshed once each morning (~11:06 GMT+7).
  - **Stale / broken** (`item_flow`, `money_flow`): frozen since 2026-05-15/16 → pipeline appears stopped.
- ⇒ The realtime stream feeds **both** ClickHouse CDP **and** (for several in-game event types) Trino/Iceberg. So the two lanes are not cleanly separated by "Kafka vs batch"; the split is by *table/pipeline*, not by engine.
- Data-quality flags: `etl_ingame_login.login_time` has **future timestamps** (max 2026-10-27); `item_flow`/`money_flow` ingestion dead ~1 month. Confirm lineage via OpenMetadata lineage API to nail topic→table sourcing.

---

## 3. What serves which use case (today)

| Need | Engine / store | Latency | Example |
|---|---|---|---|
| Ad-hoc analytics, dashboards, metric exploration | **Trino `game_integration`** via Cube/Metabase/Jupyter | T-1 batch | DAU, ARPU, retention, funnels |
| AI chat / explore (this app) | **cube-playground** → Cube → Trino (+ MCP) | T-1 | "iOS vs Android revenue last 3 months" |
| Realtime UA + activity serving | **ClickHouse CDP** (`masterfile_*`, `role_active`, `appsflyer_*`) | near-RT | installs by channel, DAU by geo |
| Live audience segments | **Apollo** (+ ClickHouse, PII hub, Mongo billing) | near-RT | revenue>200k last 7d → send code |
| Live event triggers | **Apollo on Kafka** (stateless) | RT (seconds) | reach level 20 → in-app msg |
| Identity / PII resolution | VGA non-PII + PII hub (Decree-147 mapping) | mixed | appsflyer_id ↔ user_id ↔ VGA |
| Governance / discovery | **OpenMetadata** | catalog | dataProduct assets, lineage |

---

## 4. The v11 Vision (target state, from the SVG)

The vision **renames/unifies** the activation side as **Tesseract (CDP)** and formalizes a clean split by use-case type (LT / LS / PS):

- **Kafka = shared stream** feeding BOTH:
  - **Apollo (Temporal)** — *Live Triggers* (LT): stateless, event-driven, parse schema → evaluate rule → fire action (message/code/in-app). Not segments. Configured in Apollo Interface.
  - **Tesseract (CDP)** ingestion — normalize · derive player key · event-time · dedup; **stream path → live overlay**, **batch path → base**; overlay+base combined at read.
- **Tesseract (CDP)** — *Live Segment* (LS, main use) + **part of** *Past Segment* (PS) but **only for human-pre-defined metrics**; eventual (as-of) consistency, exact reads hit base. No dynamic raw exploration.
- **Cube** — *Past Segment* (PS): standard metrics/model, pre-calculate, serves UC1; **dynamic model to explore raw data** (demos UC2 + UC3); reads clean data from **Trino/Iceberg (DWH 2.0)**; also serves the **analytic branch → MCP Connector → AI Chat UI** (= cube-playground).
- **OpenMetadata** — syncs schema+samples from Kafka & Trino/Iceberg; powers the **Log Raw Inventory** + **Metrics & Dimension Catalog** in the Product layer.
- **Product layer**: Apollo Interface (run campaigns), AI Chat UI (Claude Desktop, explore raw), Metrics&Dimension Catalog (governed; populated by integration + UC2 manual + UC3 AI), Log Raw Inventory (schema/samples, fed by OpenMetadata).

**Four authoring use cases:**
- **UC1** manual segment from catalog (no new metric) → e.g. LS-1 revenue>200k/7d, PS-2 win-back.
- **UC2** explore raw → define new metric → choose pre-calc vs on-the-fly → then UC1. *Demoed via Cube.*
- **UC3** AI-assisted explore: AI reads raw-log schema, proposes dims+metrics+distribution → validate → UC1. *Demoed via Cube.*
- **UC4** AI natural-language create: NL → map to existing catalog metrics → build rule (same scope as UC1).

**THE open architectural decision (stated on the diagram):**
> Backend — under discussion: **one solution (Tesseract) for live + past, OR Cube + Tesseract?**

I.e. does Tesseract absorb past-segments too, or does Cube keep past/analytic while Tesseract owns live? Cube's differentiator in the vision = the *dynamic raw-exploration model* Tesseract explicitly does not have.

---

## 5. Current → Vision mapping

| Vision component | Today's realization | Gap to close |
|---|---|---|
| Game Raw Logs → GDS Parse+Integrate | GIO + DA Spark batch (T-1) | rename/clarify; same flow |
| Trino/Iceberg "DWH 2.0 clean base" | Trino `game_integration` (etl/std/cons/mf) | already live; "DWH 2.0" is the Iceberg modernization |
| Kafka shared (LT + CDP) | Kafka exists; consumed by CDP/ClickHouse today | Apollo-on-Kafka live-trigger path = the new/explicit part |
| Tesseract (CDP) | **ClickHouse CDP + Apollo + Mongo billing + PII hub** (today, fragmented) | unify into one overlay+base engine w/ metric registry |
| Cube (past + analytic + MCP) | **cube-dev + cube-playground + chat-service** (this repo) | this is us; we're the Cube + AI-Chat + MCP branch |
| OpenMetadata catalog | metadata.gds.vng.vn (live; schema-only, sparse curation) | enrich descriptions/lineage; wire catalog → product layer |
| Metrics&Dimension Catalog / Log Raw Inventory | partially = our metric registry + coverage tooling | formalize, sync from OpenMetadata |

**Where cube-playground sits:** we ARE the "Cube → MCP Connector → AI Chat UI" + "Past Segment / analytic explore" branch (UC1/UC2/UC3/UC4 authoring, Segments builder). We read Trino `game_integration` batch. We do **not** touch the realtime Kafka/Apollo/ClickHouse lane today.

---

## 6. How to merge/combine (the practical join story)

- **Identity spine = Trino `mf_users`** — only place carrying BOTH `appsflyer_id` (acquisition) and `user_id` (in-game) + campaign/adset/ad. ClickHouse CDP tables are single-keyed (install side = appsflyer_id; activity side = user_id) and **cannot self-join acquisition→player**. So cross-domain stitching belongs in the batch/Trino lane (or Tesseract's "derive player key" step in the vision).
- **Live vs historical**: live membership (last-N-window, "20 fish in 2 days") → Tesseract overlay/Apollo on Kafka; historical/daily cohorts → Cube on Trino. The vision's overlay+base = how Tesseract reconciles the two at read time.
- **Metric governance**: a new metric defined in UC2/UC3 should register into the shared catalog so UC1/UC4 (and both Cube + Tesseract) can reuse it — avoids the current silo where Cube metrics ≠ CDP metrics ≠ Apollo dimensions.
- **PII/compliance**: PII stays in the PII hub (Decree-147, RAZ); segments reference resolved keys, not raw PII.

---

## Unresolved questions
1. **Cube vs Tesseract for Past Segment** — the diagram's open decision. Does our Cube/cube-playground own all PS + analytic, with Tesseract live-only? Or does Tesseract subsume pre-defined PS metrics (with Cube only for dynamic raw exploration)? This determines how much of the Segments feature we build vs hand to Tesseract.
2. **Is Tesseract built yet, or still the ClickHouse-CDP + Apollo stack?** "Tesseract" appears only on the vision SVG, not in current Confluence page titles — likely the *future* unified engine. Confirm status with data-platform (Hòa/Dương).
3. **Does the batch Trino lane consume Kafka-landed data or game-log files?** Confirmed batch + T-1, but exact landing path (Kafka→MinIO vs GIO file drop) worth verifying for freshness reasoning.
4. **Metric/Dimension Catalog ownership** — who owns the shared catalog the vision centers on, and does our metric registry become it or feed it?
5. **DWH 2.0** (`319032597`) — scope of the Iceberg modernization vs today's `game_integration`; not yet read.
