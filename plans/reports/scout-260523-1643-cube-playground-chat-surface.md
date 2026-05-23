# Scout Report: Cube Playground Chat Agent Integration Surface

**Date:** 2026-05-23 | **Scope:** Integration surface mapping for future chat agent service

---

## 1. Top-Level Dev/Prod Stack

### Client (Vite + React)
- **Port:** 3000 (dev), reverse-proxied through deployment
- **Build framework:** Vite 5 + React 18 + TypeScript (strict)
- **Commands:**
  - `npm run dev` — Vite dev server on :3000
  - `npm run build` — `tsc --noEmit && vite build` → `dist/`
  - `npm run preview` — Vite preview of built app
- **Proxy routing (vite.config.ts:21-27):**
  - `^/playground/.*` → `http://localhost:4000` (Cube Core dev)
  - `^/cubejs-api/.*` → `http://localhost:4000` (Cube API)
  - `/api` → `http://localhost:3004` (Node/Fastify server)

### Server (Fastify + Node.js)
- **Port:** 3004 (default via `PORT` env var)
- **Framework:** Fastify 4.28.1 (ES modules, TypeScript)
- **Commands:**
  - `npm --prefix server run dev` — `tsx watch src/index.ts`
  - `npm --prefix server run build` — `tsc`
  - `npm --prefix server run start` — `node dist/index.js`
  - `npm run dev:all` — concurrently runs both Vite + Fastify
- **Bootstrap (server/src/index.ts:30-94):**
  - Registers Fastify instance
  - Loads plugins: CORS, owner-header middleware
  - Registers route handlers (see **Server Architecture** below)
  - Hydrates SQLite DB from snapshot on first run
  - Starts cron jobs unless in test/prod mode

### Cube Backend (External)
- **URL:** `http://localhost:4000` (dev env var `CUBE_API_URL`, default fallback)
- **Token source (server/src/services/resolve-cube-token.ts):**
  1. `CUBE_TOKEN_<GAME>` env var (per-game pre-minted token)
  2. `CUBEJS_API_SECRET` env var (mint fresh HS256 token with `game` claim in-process)
  3. `CUBE_TOKEN` env var (legacy single-token fallback)
  4. `null` if none available
- **Endpoints used:** `/cubejs-api/v1/meta`, `/cubejs-api/v1/load`, `/cubejs-api/v1/sql`

---

## 2. Server Architecture

### HTTP Framework & Bootstrap
- **File:** `server/src/index.ts`
- **Framework:** Fastify (async/await, plugin-based)
- **Root path:** `/api` prefix
- **Health check:** `GET /api/health` → `{ ok: true }`
- **CORS:** Enabled globally via `@fastify/cors`
- **Owner header middleware:** `src/middleware/owner-header.ts` (auth context from request)

### Route Handlers (Registered Plugins)
All routes live under `/api/` prefix. Files in `server/src/routes/`:

| Route File | HTTP Methods | Endpoints |
|---|---|---|
| `segments.ts` | GET/POST | `/api/segments`, `/api/segments/:id`, `/api/segments/:id/sql-filter`, etc. |
| `analyses.ts` | GET/POST | `/api/analyses`, `/api/analyses/:id` |
| `identity-map.ts` | GET/POST | `/api/identity-map/*` |
| `presets.ts` | GET | `/api/presets`, `/api/presets/:id` |
| `meta-version.ts` | GET | `/api/meta-version` |
| `preview.ts` | POST | `/api/preview` (card runner) |
| **`games.ts`** | GET | `/api/playground/games` — **reads `gds.config.json`** |
| **`cube-token.ts`** | GET | `/api/playground/cube-token?game=<id>` — **token resolution** |
| `cdp-metrics.ts` | POST | `/api/cdp-metrics/*` |
| `business-metrics.ts` | GET/POST | `/api/business-metrics`, `/api/business-metrics/:id` |
| `anomaly-state.ts` | GET/POST | `/api/anomaly-state/*` |
| `fixtures.ts` | (dev-only) | `/api/fixtures/*` (seed test data) |

### LLM/Chat Code
**No existing LLM integration.** The `/chat` client route (src/pages/ChatPlaceholder) is a placeholder with "Chat coming soon."

### Auth Strategy
- **Client-side:** Cube JWT stored in localStorage (`gds-cube:token`) + Cube `SecurityContext`
- **Server-side:** Owner header + per-game token resolution (`CUBE_TOKEN_<GAME>` or minted from `CUBEJS_API_SECRET`)
- **Game scoping:** Request context includes `game` claim; server resolves the correct Cube token per game via `resolveCubeTokenForGame(gameId)`
- **Playground user:** Default principal is `'playground'` (env var `CUBE_PLAYGROUND_USER_ID` to override)

### Cube Integration
- **Client:** `@cubejs-client/core` REST client + React hooks (`@cubejs-client/react`)
- **Server:** Thin fetch wrapper (`src/services/cube-client.ts`)
  - `getMeta(tokenOverride?)` — GET `/cubejs-api/v1/meta`
  - `load(query, tokenOverride?)` — POST `/cubejs-api/v1/load`
  - `sql(query, tokenOverride?)` — POST `/cubejs-api/v1/sql`
- **Trino integration:** None detected. All SQL generation is Cube-scoped (predicate-to-sql generates WHERE clauses for filters, not raw Trino queries).

### Games Config Loader
- **File:** `server/src/services/games-config-loader.ts`
- **Source:** `gds.config.json` at repo root (or env var `GDS_CONFIG_PATH`, or walked up from `server/` cwd)
- **Interface:**
  ```typescript
  interface GamesConfig {
    defaultGameId: string;
    games: GameDef[];
  }
  interface GameDef { id: string; name: string; mark?: string; color?: string; }
  ```
- **Caching:** In-process singleton, cleared only in tests (`__resetGamesConfigCache()`)
- **Fallback:** If not found, defaults to `[{ id: 'ptg', name: 'Play Together', mark: 'PT' }]`

---

## 3. YAML Business Metrics Registry

### Location & Structure
- **Directory:** `server/src/presets/business-metrics/`
- **File count:** ~19 `.yml` files (DAU, MAU, Revenue, Cost, ROAS, etc.)
- **Total lines:** ~300–400 lines across all files
- **Naming:** `<metric-id>.yml` (e.g., `revenue.yml`, `dau.yml`, `mau.yml`)

### Example File: `revenue.yml`
```yaml
id: revenue
label: Revenue
description: >-
  Total value of in-game items successfully delivered to users during the
  selected period. Recognised by item delivery (consumption) date.
synonyms: [in_game_revenue, rev]
tier: 1
domain: revenue
owner: data-platform@vng
trust: certified
formula:
  type: measure
  ref: recharge.revenue_vnd
unit: VND
format: currency
game_compatibility:
  required_cubes: [recharge]
related_concepts:
  - mf_users.country
  - mf_users.media_source
```

### Loader Service
- **File:** `server/src/services/business-metrics-loader.ts`
- **Behavior:**
  - Reads all `*.yml` files from registry at startup
  - Zod-validates against schema (strict parsing)
  - Caches in-process; watched for file changes in dev
  - Exposes via `/api/business-metrics` endpoint

### Schema Format (Zod schema in loader)
- `id`, `label`, `description`, `synonyms`, `tier`, `domain`, `owner`, `trust`
- `formula` — `type: 'measure' | 'dimension'`, `ref: 'cube.member'`
- `unit`, `format`, `game_compatibility`, `related_concepts`

**Note:** These are NOT Cube YAML model files. Cube model (cubes, dimensions, measures, joins) is served from Cube's `/cubejs-api/v1/meta` endpoint.

---

## 4. Trino Integration

**Direct Trino execution: NOT present.**

- Server generates SQL WHERE clauses (`src/services/predicate-to-sql.ts`) for segment filters but does not execute raw SQL against Trino.
- All analytics queries flow **through Cube** (`/cubejs-api/v1/load`), which manages Trino connections internally.
- The `sql()` helper (`cube-client.ts:73-78`) returns the **compiled SQL** for a Cube query (read-only, for display).

---

## 5. Playground Query URL Shape & Deeplink System

### URL Format
- **Hash route:** `#/build?query=<encoded-json>`
- **Fallback:** `#/build?from-segment=<segment-id>` (uses sessionStorage if URL too long)
- **URL limit:** 8000 chars (typical browser limit)

### Query Structure (Cube JSON)
```typescript
// From src/stores/playground-store.ts:24-34
type Query = {
  measures?: string[];     // e.g., ["recharge.count", "recharge.revenue_vnd"]
  dimensions?: string[];   // e.g., ["user.country", "user.media_source"]
  filters?: FilterItem[];  // e.g., [{ member: "user.uid", operator: "in", values: ["123", "456"] }]
  timeDimensions?: TimeDimensionItem[];
  order?: OrderItem[];
  granularity?: string;
  limit?: number;
};
```

### Deeplink Builder
- **File:** `src/utils/playground-deeplink.ts`
- **Entry point:** `buildPlaygroundDeeplink(input: DeeplinkInput) → DeeplinkResult`
- **Input:**
  ```typescript
  {
    baseQuery?: Record<string, unknown>;  // e.g., pre-set measures/dimensions
    segmentId: string;
    segmentName: string;
    identityDim: string;                  // e.g., "user.uid"
    primaryCube: string | null;           // e.g., "user" or "recharge"
    uids: string[];                       // user IDs to filter
  }
  ```
- **Output:** `{ url: string, via: 'inline' | 'session-storage' }`
- **SessionStorage key:** `gds-cube:pending-deeplink:<segmentId>`

### Client-Side Route Consumption
- **Route:** `#/build`
- **Query param consumption:** Happens in Playground component; reads `?query=` or `?from-segment=`
- **State source:** URL is single source of truth for query; localStorage only persists `chartType` + `pivotConfig` preferences (src/stores/playground-store.ts:85-88)

---

## 6. Existing Chat UI Scaffolding

### Router Entry
- **File:** `src/index.tsx:38-42`
  ```typescript
  const ChatPlaceholderPage = loadable(() =>
    import('./pages/ChatPlaceholder/chat-placeholder-page').then((m) => ({
      default: m.ChatPlaceholderPage,
    }))
  );
  ```
- **Route:** `/chat` (exact match)

### Placeholder Page
- **File:** `src/pages/ChatPlaceholder/chat-placeholder-page.tsx`
- **Content:** "Chat coming soon" message + link to `/build`
- **Status:** Empty-state, no backend wired

### Sidebar Integration
- **File:** `src/shell/sidebar/sidebar.tsx`
- **Entry:** "No recent items" link to `/chat` in sidebar
- **Breadcrumb:** Handled in `src/shell/topbar/breadcrumb.tsx` (maps `/chat` → "Chat")

### Theme/Token Context
- **Design tokens:** `src/shell/theme.tsx` exposes `T` proxy object (Hermes design system)
- **Available tokens:** Neutral scale (n50–n950), brand colors, semantic aliases (surface, sidebar, topbar), fonts (fDisp, fSans, fMono)
- **CSS file:** `src/theme/tokens.css` — global CSS var definitions (--hermes-*, --neutral-*, --orange-*, status colors)
- **Example:** `T.n200`, `T.brand`, `T.surface`, `T.fSans`

---

## 7. Recommended Integration Points for New Chat Service

### Architecture: Separate Python Backend + Node Router
**Rationale:** Chat LLM orchestration is better handled in Python (LangChain, Anthropic SDK); Node server acts as a router and token-scoped query executor.

```
┌─────────────────────────────────────────────────────────────┐
│ Client (React, :3000)                                       │
│  /chat route → ChatPage component                           │
│  • Query box (natural language)                             │
│  • Query summaries (clickable → deeplink to /build)         │
│  • Chat history                                             │
└───────────────┬─────────────────────────────────────────────┘
                │ fetch('/api/chat/query', { message: "..." })
                ▼
        ┌────────────────────────────────────┐
        │ Node Fastify Server (:3004)        │
        │ → /api/chat/* route handlers       │
        │   (route + delegate to Python)     │
        └──────────────┬─────────────────────┘
                       │ POST http://localhost:5000/query
                       ▼
        ┌────────────────────────────────────┐
        │ Python Chat Service (:5000)        │
        │ • Parse natural language query     │
        │ • Call Cube /meta for schema       │
        │ • Generate Cube query JSON         │
        │ • Call server GET /api/cube/*      │
        │   to fetch Cube token + execute    │
        │ • Build deeplink URL               │
        │ • Return { summary, deeplink }     │
        └────────────────────────────────────┘
                       │
                       ▼
        ┌────────────────────────────────────┐
        │ Cube Backend (:4000)               │
        │ /cubejs-api/v1/meta, /load, /sql   │
        └────────────────────────────────────┘
```

### Node Routes to Add
**File:** `server/src/routes/chat.ts` (new)

```typescript
export default async function chatRoutes(app: FastifyInstance): Promise<void> {
  // 1. User sends natural language query
  app.post<{ Body: { message: string } }>(
    '/api/chat/query',
    async (req) => {
      const { message } = req.body;
      // 2. Forward to Python service
      const res = await fetch('http://localhost:5000/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ownerToken}` },
        body: JSON.stringify({ message, game: req.game }),
      });
      return res.json();
    }
  );

  // 2. Helper: fetch Cube token for Python service to call Cube
  app.get<{ Querystring: { game: string } }>(
    '/api/chat/cube-token',
    async (req) => {
      const token = resolveCubeTokenForGame(req.query.game);
      return { token };
    }
  );

  // 3. History endpoint
  app.get('/api/chat/history', async (req) => {
    // Return chat history from SQLite (new table: chat_messages)
  });
}
```

### Python Service Structure
**Language:** Python 3.10+ | **Framework:** FastAPI

```
chat-service/
├── main.py               # FastAPI app, /query endpoint
├── query-planner.py      # Parse natural language → Cube query JSON
├── cube-client.py        # Fetch /meta, schema caching
├── deeplink-builder.py   # Build playground deeplinks
├── requirements.txt      # anthropic, fastapi, uvicorn, pydantic
└── .env                  # CUBE_API_URL, CUBE_META_CACHE_TTL, etc.
```

### Database Schema Addition (SQLite)
**File:** `server/src/db/` (new migration)

```sql
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  user_message TEXT NOT NULL,
  query_json TEXT,               -- Cube Query as JSON
  query_summary TEXT NOT NULL,   -- LLM-generated summary
  deeplink_url TEXT,             -- #/build?query=…
  created_at INTEGER NOT NULL,
  executed_at INTEGER,
  result_row_count INTEGER,
  FOREIGN KEY(owner_id) REFERENCES owners(id)
);

CREATE INDEX idx_chat_owner_game ON chat_messages(owner_id, game_id);
CREATE INDEX idx_chat_created ON chat_messages(created_at DESC);
```

### Client Route & Component
**File:** `src/pages/Chat/chat-page.tsx` (replace placeholder)

```typescript
export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/chat/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input }),
    });
    const { summary, deeplink, sql } = await res.json();
    setMessages([...messages, { role: 'assistant', summary, deeplink, sql }]);
    setInput('');
    setLoading(false);
  };

  return (
    <div style={{ padding: 24 }}>
      <h1>Analytics Chat</h1>
      {/* Messages + summary pills (clickable → deeplink) */}
      {/* Input form */}
    </div>
  );
}
```

### Environment Variables
**Server `.env` additions:**
```
CHAT_SERVICE_URL=http://localhost:5000
CUBE_META_CACHE_TTL=3600
```

**Python `.env`:**
```
CUBE_API_URL=http://localhost:4000
FASTIFY_URL=http://localhost:3004
ANTHROPIC_API_KEY=sk-...
```

---

## 8. Theme/Design System

### CSS Tokens File
**File:** `src/theme/tokens.css`
- Neutral scale: `--hermes-n50`, `--hermes-n100`, ..., `--hermes-n950`
- Brand: `--hermes-brand`, `--hermes-brand-hover`, `--hermes-brand-soft`, `--hermes-brand-border`
- Status: red/blue/green/amber/purple (500/600/soft variants)
- Semantic: `--hermes-surface`, `--hermes-surface-muted`, `--hermes-surface-subtle`
- Shell: `--hermes-shell`, `--hermes-sidebar`, `--hermes-topbar`
- Fonts: CSS var system (not directly exposed; use `T.fSans`, `T.fMono`)

### Theme Proxy (`T`)
**File:** `src/shell/theme.tsx`
```typescript
const T = {
  n200: 'var(--hermes-n200)',
  brand: 'var(--hermes-brand)',
  surface: 'var(--hermes-surface)',
  fSans: '"Inter", sans-serif',
  // ... 80+ tokens
};
```
**Usage:** `<div style={{ color: T.n500, background: T.surface }}>`

### Design System
- **Icon library:** Lucide React (1.16.0)
- **UI Kit:** `@cube-dev/ui-kit` (0.52.3) + Ant Design 4.16.13
- **CSS-in-JS:** styled-components 6.1.12
- **Responsive:** react-responsive for breakpoint hooks

---

## Summary & Unresolved Questions

### Integration Checklist
- [x] Client route `/chat` exists (placeholder)
- [x] Sidebar + breadcrumb wired
- [x] Deeplink builder ready (`playground-deeplink.ts`)
- [x] Cube token resolution service exists
- [x] Theme tokens available
- [x] Games config loader + per-game scoping
- [ ] Python chat service (to build)
- [ ] Node `/api/chat/*` routes (to add)
- [ ] SQLite `chat_messages` table (to migrate)
- [ ] Chat UI component (to replace placeholder)

### Unresolved Questions
1. **Chat history persistence:** Store in Node's SQLite or Python's own DB? (Recommend: Node SQLite with sync to Python cache.)
2. **Concurrency limits:** Should Python service enforce per-game query rate limits or defer to Node middleware?
3. **Cube meta caching:** Python should cache `/meta` responses; TTL and invalidation strategy? (Recommend: 1h TTL, invalidate on `/api/games` change event.)
4. **Streaming vs polling:** Chat response (streaming tokens + summary finalization)? Or fire-and-forget JSON + polling? (Recommend: WebSocket or Server-Sent Events for UX.)
5. **Error handling:** If Python service unreachable, should Node return cached responses or 503? (Recommend: 503 + client-side fallback to manual query builder.)

