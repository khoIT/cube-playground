# Cube Security & RBAC Research — May 2026

**Last verified:** cube.dev/docs, Feb 2025 cutoff + May 2026 runtime behavior

---

## 1. Data-Model Visibility Control

**How Cube controls cube/view/member visibility:**

- **`public: true|false`** (cube/view level): When `false`, cube cannot be queried via API; hides the cube from `/v1/meta` endpoint entirely.
  - Default: `true` (visible).
  - Set in YAML: `cube('CubeName') { ... public: false ... }`

- **`/cubejs-api/v1/meta` endpoint behavior:**
  - Returns only cubes/views where `public: true`.
  - When user has no Authorization header (unauthenticated), returns only public metadata.
  - `access_policy` rules further restrict member visibility **after** metadata fetch (applies to query execution, not /meta introspection).

- **`?extended=true` parameter:** NOT officially implemented in current Cube docs. Appears as TODO in OpenAPI spec; does not change /meta visibility today.

**Takeaway:** `public:false` hides from /meta. Access policies apply to query-time enforcement, not metadata introspection.

---

## 2. Access Policies (Role/Member-Based)

**Available:** Yes, in both **Cube Core (v1.2.0+)** and **Cube Cloud** (GA).

**YAML syntax (access_policy parameter in cubes/views):**

```yaml
cube('Orders') {
  # Member-level: control which dimensions/measures users can access
  access_policy: [
    {
      group: 'manager',
      member_level: {
        includes: ['*'],  # all members
      }
    },
    {
      group: 'observer',
      member_level: {
        excludes: ['revenue', 'cost']  # deny these members
      }
    },
    {
      group: 'analyst',
      row_level: {
        filters: [
          {
            member: 'state',
            operator: 'equals',
            values: ['{securityContext.department}']  # row-level filtering
          }
        ]
      }
    }
  ]
}
```

**Key features:**
- `group` or `groups` (array): target user group(s) from JWT security context; `"*"` = all users.
- `member_level.includes / excludes`: dimension/measure visibility.
- `row_level.filters`: SQL-like filters applied to rows (supports `equals`, `contains`, `gte`, boolean `and`/`or`).
- `conditions`: optional checks on security context before policy applies (e.g., `if: securityContext.role == 'admin'`).
- `member_masking`: return masked values (`***`, `-1`, `NULL`) instead of denying access.

**Introduced:** Cube Core v1.2.0 (2024), now GA in both Core and Cloud.

**Applies to:** Cube Core (open-source) and Cube Cloud equally.

---

## 3. Security Context & JWT Flow

**How it works:**

1. Client sends JWT in `Authorization: Bearer <token>` header.
2. Cube's `checkAuth()` function:
   - Verifies JWT (using JWKS or secret).
   - Decodes payload → becomes `securityContext` (JSON object).
   - Default: parses root claims (not nested under `u` anymore; renamed from `authInfo`).

3. `securityContext` is accessible in:
   - **`query_rewrite`** configuration: Rewrite queries at compile time (e.g., add mandatory filters).
   - **`COMPILE_CONTEXT`** global: Build cube definitions dynamically per user.
   - **`access_policy` rules**: Evaluate group/role/attribute-based restrictions.

**Example JWT payload:**
```json
{
  "sub": "user123",
  "role": "manager",
  "department": "sales",
  "state": "CA"
}
```

**Example usage in access_policy:**
```yaml
row_level: {
  filters: [
    { member: 'department', operator: 'equals', values: ['{securityContext.department}'] }
  ]
}
```

**Important:** For Cube Core, reference `securityContext` (not `userAttributes` which is Cube Cloud terminology).

---

## 4. Anonymous Access Behavior

**If `/cubejs-api/v1/meta` returns 200 with NO Authorization header:**

- Means: `CUBEJS_DEFAULT_API_SCOPES` includes `meta` scope (or no scopes configured = all scopes default).
- Cube will return cubes/views with `public: true` only.
- User's security context is empty (no JWT claims).

**Does `/load` (POST query) also open?**
- **No, they can differ.** Use `contextToApiScopes` to gate endpoints independently.

**Example:**
```javascript
// Allow /meta without auth, but require auth for /load
contextToApiScopes: (securityContext) => {
  if (!securityContext || !securityContext.sub) {
    return ['meta'];  // anonymous can only see metadata
  }
  return ['meta', 'data', 'graphql'];  // authenticated: full access
}
```

**API Scopes:** Each endpoint belongs to a scope (`meta`, `data`, `graphql`). Control access via `CUBEJS_DEFAULT_API_SCOPES` environment variable or `contextToApiScopes` configuration.

---

## 5. App-Level RBAC (Cube Cloud) vs Data-Model RBAC

**Cube Cloud app-level RBAC (Workspace/Deployment level):**
- Controls **who logs into Cube Cloud UI**, workspace membership, permission to edit data models, access Playground.
- Lives in Cube Cloud's managed platform layer.
- Example: "Alice is admin of my-workspace; Bob is read-only."

**Data-Model RBAC (enforced in Cube Core & Cloud equally):**
- Controls **which data users can query** at runtime via REST/GraphQL API.
- Defined in YAML (`access_policy`), evaluated against JWT security context.
- Applies to queries from any consumer (BI tools, custom apps, AI agents).

**For third-party apps calling Cube REST API:**
- **Use data-model RBAC** (access_policy in cubes/views).
- App-level RBAC is irrelevant; only the JWT claims in the request matter.
- The JWT comes from your app's auth system (not Cube Cloud login).

---

## 6. Practical Recommendation: Where Should RBAC Live?

**For multi-user internal tool querying a DA-controlled Cube deployment:**

| Layer | Responsibility | Example |
|-------|-----------------|---------|
| **JWT (your app)** | Mint claims tied to user identity | Include `role`, `department`, `user_id` in JWT payload |
| **Cube data-model** | Enforce authorized access | Define `access_policy` with row/member filters keyed to JWT claims |
| **Your app** | UI/UX filtering, audit logging | Show only tables user's Cube query will allow; log who queried what |

**Why this split:**
- Cube data model is the **enforcement gate**: even if app code has a bug, Cube's access_policy blocks unauthorized queries.
- App mints JWTs with correct claims → Cube evaluates claims → query succeeds or fails server-side.
- Prevents data exfiltration if app's DB is compromised.

**Implementation sketch:**
```javascript
// Your app: mint JWT
const jwt = sign({
  sub: user.id,
  role: user.role,
  department: user.department
}, secret);

// POST to Cube with Authorization: Bearer <jwt>
fetch('https://cube-deployment/cubejs-api/v1/load', {
  headers: { Authorization: `Bearer ${jwt}` }
});
```

```yaml
// Cube data model: enforce
cube('Sales') {
  access_policy: [
    {
      group: 'sales',
      row_level: {
        filters: [
          { member: 'department', operator: 'equals', values: ['{securityContext.department}'] }
        ]
      }
    }
  ]
}
```

---

## 7. Cross-Check: /meta Visibility & public Field

| Scenario | `/meta` Returns | Query `/load` Works? |
|----------|-----------------|----------------------|
| `public: true`, no auth header | Yes (metadata only) | No (no JWT → `access_policy` block or require explicit auth) |
| `public: true`, valid JWT | Yes + members visible per `access_policy` | Yes (if `access_policy` grants access) |
| `public: false`, any auth | Hidden from `/meta` | No (cube not queryable) |

**Takeaway:** `public: false` + access_policy are complementary. `public` hides from metadata; `access_policy` restricts queries at runtime.

---

## 8. Version & Feature Availability

| Feature | Cube Core | Cube Cloud | Introduced |
|---------|-----------|-----------|------------|
| `access_policy` (member/row-level) | ✅ v1.2.0+ | ✅ GA | 2024 |
| `securityContext` (JWT claims) | ✅ | ✅ | Stable |
| `query_rewrite` (custom filters) | ✅ | ✅ | Stable |
| `contextToApiScopes` (per-endpoint gating) | ✅ | ✅ | Stable |
| Row-level security (SQL filters) | ✅ | ✅ | Stable |
| Data masking (`member_masking`) | ✅ | ✅ | Stable |

All core RBAC features are available in **open-source Cube Core** — no Cube Cloud paywall.

---

## 9. Important Gotchas

1. **`?extended=true` doesn't exist yet.** Don't rely on it for extended metadata filtering.
2. **`public: false` hides from /meta but not from data-model compilation.** Use `access_policy` to enforce row/member restrictions; `public: false` is visibility, not access control.
3. **Anonymous /meta + gated /load is possible but requires explicit `contextToApiScopes` config.** Default allows both or neither.
4. **Cube Cloud reserved field:** Don't use `cubeCloud` in your JWT claims; it's reserved for Cube Cloud's auth integration.
5. **Conditions in `access_policy` are AND-ed.** All conditions must be true for the policy to apply.

---

## 10. Unresolved Questions

- **Row-level filter performance:** Does Cube inline row filters into the compiled SQL, or fetch-then-filter? (Not explicitly stated in docs; likely inlined, but worth benchmarking on your data volumes.)
- **API scope interaction with access_policy:** If user lacks `data` scope, does Cube evaluate access_policy at all, or reject the request outright? (Likely rejects before evaluation, but not confirmed in docs.)
- **Member visibility inheritance in views:** When a view selects from a restricted cube, do the member-level restrictions carry over? (Docs state masking carries over; member visibility is less clear.)

---

## Sources

- [Access policies | Cube documentation](https://cube.dev/docs/product/auth/data-access-policies)
- [Security context | Cube documentation](https://cube.dev/docs/product/auth/context)
- [Row-level security | Cube documentation](https://cube.dev/docs/product/auth/row-level-security)
- [Member-level security | Cube documentation](https://cube.dev/docs/product/auth/member-level-security)
- [Controlling access to cubes and views | Cube Docs](https://cube.dev/docs/guides/recipes/access-control/controlling-access-to-cubes-and-views)
- [Cubes | Cube documentation](https://cube.dev/docs/product/data-modeling/reference/cube)
- [REST API | Cube documentation](https://cube.dev/docs/product/apis-integrations/rest-api)
- [Configuration options | Cube documentation](https://cube.dev/docs/product/configuration/reference/config)
- [Cube Core v1.2 — Data access policies, hierarchies & folders, updates to Playground - Cube Blog](https://cube.dev/blog/cube-core-v1-2-data-access-policies-hierarchies-and-folders-updates-to)
- [GitHub: cube-js/cube](https://github.com/cube-js/cube)
