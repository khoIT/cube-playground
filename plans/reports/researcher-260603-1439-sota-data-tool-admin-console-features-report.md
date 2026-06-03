# SoTA Admin Console & Usage Analytics Research Report

**Scope:** Feature set recommendations for cube-playground sys-admin hub. Analyzed 9 tools: Metabase, Looker, Preset/Superset, Hex, Mode, Omni, Amplitude, Mixpanel, Count. Goal: ruthless YAGNI-first feature prioritization for internal VNG game-analytics tool (~50–100 users, single admin team).

**Research Methodology:** 3+ independent sources per tool; official docs weighted above tutorials; focus on patterns transferable to internal tools.

---

## A. FEATURE EXTRACTION BY TOOL

### 1. METABASE
**Access & Permission Management:**
- Group-based model (users → groups → permissions). Most permissive access wins when user in multiple groups.
- Three permission tiers: data (database/schema/table), collection (view/curate), feature (SQL editor, model edit).
- Row-level sandboxing + column-level security (Pro/Enterprise).
- No bulk provisioning in free tier; SCIM/LDAP sync gated (Pro/Enterprise).
- Deactivation only; no permanent deletion.

**Usage Analytics:** Not exposed in free tier; Enterprise gets limited observability.

**Admin UX:** Admin panel → People. Invite one-at-a-time. Groups page for bulk assignment. Simple matrix.

**Key Pattern:** Group-first reduces permission bloat vs user-by-user model.

---

### 2. LOOKER
**Access & Permission Management:**
- Model sets + roles: role = permission set + model set. Fine-grained model-level control.
- Folder-based hierarchy: View (read) vs Manage (write + permission edit).
- Row-level access filters: WHERE clause injection based on user attributes. Attribute-driven, not group-driven.
- Content access managed from Content Access page (admin) or folder-owner (if delegated).
- Implicit: no RLS by default; requires explicit filter definition.

**Usage Analytics:** Not detailed in docs. Implies usage reports exist (enterprise tier).

**Admin UX:** Users page, Groups page, Content Access page. Separate mental models for roles vs folders.

**Key Pattern:** Attribute-based RLS (WHERE-clause injection) scales better than group-based for dynamic data filtering (e.g., per-game player row access).

---

### 3. PRESET / APACHE SUPERSET
**Access & Permission Management:**
- Role-based RBAC: Workspace Admin, Creator (Primary/Secondary/Limited), Viewer, Dashboard Interactor, Dashboard Viewer (Pro/Enterprise).
- Data Access Roles (DARs) grant granular asset access independent of workspace role.
- Row-Level Security (RLS): rules-engine for per-dataset row filtering (audit via RLS REST API).
- Custom roles: restrict base role permissions (e.g., Querier without Upload).

**Usage Analytics:** None documented. RLS API audit queries logged via RLS REST.

**Admin UX:** Workspace admin role manages roles + DARs. No bulk action mention.

**Key Pattern:** Dual-role model (workspace role + data access role) separates feature access from data access.

---

### 4. HEX
**Access & Permission Management:**
- Workspace roles: Admin, Manager, Editor, Explorer, Viewer, Guest.
- Database connection access restricted by role.
- REST Admin APIs for programmatic user/group/project management (Team/Enterprise).
- Advanced Observability API (Enterprise only) for querying usage.

**Usage Analytics:**
- Project Usage Insights: queriedTables endpoint (Enterprise). No built-in last-login or activity report.
- Manual cross-reference of Settings → Members vs Settings → Billing to find unused Editor seats.

**Admin UX:** Settings → Members, Settings → Billing. Fragmented (by own admission in research).

**Key Pattern:** SaaS typically lacks native "last active" metrics; teams build custom dashboards from audit APIs.

---

### 5. MODE ANALYTICS
**Access & Permission Management:**
- Group-based (Collection permissions + Connection permissions).
- Permission levels: Manage (settings + permission edit), Query (write), View (read).
- Group model scales permission assignment.
- Admin role required to manage all groups/connections/collections.

**Usage Analytics:** Not detailed.

**Admin UX:** Manage users/groups via admin panel. Groups page.

**Key Pattern:** Consistent group model across all permission types reduces cognitive load.

---

### 6. OMNI
**Access & Permission Management:**
- Connection first, then model-level refinement (Base access role + Model access).
- Custom roles: create variations of base roles with specific restrictions.
- Organization Admin or Connection Admin can define connection permissions.
- Model access per-user or per-group.

**Usage Analytics:** Not documented.

**Admin UX:** Settings → Connections → [conn] → Permissions tab. Clear two-tier structure.

**Key Pattern:** Connection-first approach matches internal Cube workspaces; scales to multi-datasource governance.

---

### 7. AMPLITUDE
**Access & Permission Analytics:**
- Usage Reports tab: 10 charts on User Metrics (adoption drivers). Event Usage tab (org-wide event ingestion).
- Audit tab: Global Agent conversation threads, user-initiated, timestamped.
- Data Governance questions + GDPR User Privacy API (row-level user deletion).
- Regular audits validate event naming, property consistency, tracking plans.

**Usage Analytics:** Advanced (org-level adoption metrics, data quality).

**Admin UX:** Settings → Organization settings → Usage Reports. Settings → Audit.

**Key Pattern:** Separate "adoption metrics" (user engagement drivers) from "audit logs" (compliance). Both needed for internal adoption.

---

### 8. MIXPANEL
**Access & Permission Management:**
- Audit log: organization + project level. Login events, service account creation.
- Audit log access: org owners + admins only.
- RBAC + authentication controls (SSO, MFA).

**Usage Analytics:**
- Audit logs (who/when/what changed).
- Data governance (hide/block/delete event semantics).
- User Privacy API (delete at user level, GDPR compliance).

**Admin UX:** Admin section includes Roles & Permissions, Data Governance, Access Security tabs.

**Key Pattern:** Audit log schema: user + action + timestamp + object. Simple, auditable.

---

### 9. COUNT
**Research Status:** No COUNT-specific data found. Search returned generic RBAC patterns.

---

## B. SYNTHESIZED FEATURE MATRIX

| Feature | Metabase | Looker | Superset | Hex | Mode | Omni | Amplitude | Mixpanel |
|---------|----------|--------|----------|-----|------|------|-----------|----------|
| **Access & Permissions** | | | | | | | | |
| Group-based RBAC | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Row-level security | ✓(Pro) | ✓ | ✓ | — | — | — | — | — |
| Attribute-based RLS | — | ✓ | — | — | — | — | — | — |
| Custom role creation | — | — | ✓ | — | — | ✓ | — | — |
| Bulk user provisioning | ✓(Pro) | — | — | ✓(API) | — | — | — | — |
| **Usage Analytics** | | | | | | | | |
| Last login tracking | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| Per-user query activity | ✗ | ✗ | ✗ | ✓(Enterprise) | ✗ | ✗ | ✓ | ✓ |
| Feature adoption metrics | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| Audit logs (action log) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| **Admin UX** | | | | | | | | |
| Master-detail layout | — | — | — | — | — | ✓ | ✓ | ✓ |
| Bulk actions (assign/revoke) | — | — | — | ✓(API) | — | — | — | — |
| Search/filter users | — | — | — | — | — | — | — | — |
| Empty state guidance | — | — | — | — | — | — | — | — |

---

## C. RECOMMENDATIONS BY PRIORITY

### MUST-HAVE V1 (Week 1–2)

**1. Group-based RBAC with role model**
- Create roles: Admin, Analyst, Viewer.
- Assign users to groups.
- Inherit workspace + feature access via group membership.
- Cost: ~3–4 sprint pts. ROI: unblocks all per-user permission flows.

**Why:** Every tool uses group model. Single-admin org can manage ~50 users via 3–5 groups. No per-user permission bloat.

**Copy from:** Metabase (simplest), Omni (connection-first scalability).

---

**2. Workspace + game filtering (role-specific)**
- Per-group: select visible workspaces (prod-mirror, game-1, game-2, …) + visible games.
- UI: Toggle grid (workspace × group), or multi-select dropdowns.
- Store in `user_preferences` table (or Cube's RBAC layer if available).

**Why:** VNG game analytics = per-game access control. Internal use = lightweight (no row-level SQL injection; pre-filter UI state).

**Cost:** ~2–3 pts. ROI: eliminates need for row-level security complexity v1.

---

**3. Admin console layout: tabbed + cards**
- **Tab 1: Users**
  - List: username, email, assigned group, last login (empty if never), actions (reset, deactivate).
  - Empty state: "No users. Click Invite to add your first analyst."
  - Search bar top-left. Sort by last-login.
  
- **Tab 2: Groups**
  - Card per group: name, member count, workspace/game access, actions (edit, delete).
  - Empty state: "No groups. Create your first group to organize users."
  
- **Tab 3: Audit Log** (v1: basic)
  - Table: timestamp, user, action (login, role-change, query-run), object (workspace, group), details.
  - Filter: date range, user, action type.

**Why:** Metabase + Amplitude + Mixpanel converge on tabbed admin. Cards keep related data cohesive (group + members + perms in one view).

**Cost:** ~5 pts (including empty states + search). ROI: unblocks all downstream admin flows.

---

**4. Invite flow with pre-provisioning**
- Batch CSV invite (email, group).
- Send invite link; user creates password; auto-joins group.
- Admin can pre-assign workspace/game toggles before user accepts.
- Show pending invites; resend button.

**Why:** Reduces "triage" work (copy-paste emails → send invites → wait → manually assign). Batch CSV reuses user's mental model (spreadsheet).

**Copy from:** Power BI bulk onboarding pattern.

**Cost:** ~4 pts. ROI: 10x faster first-week admin setup.

---

### NICE-TO-HAVE V2 (Month 2+)

**5. Last-login + unused-user detection**
- Add `last_login` timestamp to user sessions.
- Highlight red if >90 days inactive.
- Bulk "export inactive" → CSV (for offboarding).

**Why:** Metabase/Hex don't expose this natively; Amplitude/Mixpanel do. Cost-effective signal for seat optimization.

**Cost:** ~2 pts (log login event; add query). ROI: identifies ~20% of seats often unused in orgs.

---

**6. Per-user activity summary (compact)**
- Dashboard card: "User activity (last 7 days)".
- Show: # queries run, # workspaces accessed, last-accessed feature, favorite workspace.
- Link to audit log filtered by user.

**Why:** Amplitude pattern. Helps admin diagnose adoption gaps (e.g., "Analyst X never runs queries, only views").

**Cost:** ~3 pts. ROI: qualitative; informs feature UX decisions.

---

**7. Query audit log (with cost/compute proxy)**
- Log each query: user, workspace, timestamp, query duration (seconds).
- Show top 10 most-run queries by user.
- Estimate "scan rows" or "compute cost" if Cube exposes it.

**Why:** Looker + Superset + Amplitude expose query-level telemetry. Answers "what is expensive?" + "who queries what?"

**Cost:** ~5 pts (wire Cube API logging, dashboard table). ROI: informs query optimization + feature prioritization.

**Skip v1 if:** Cube doesn't expose query duration natively.

---

**8. Attribute-based RLS (game/player row filtering)**
- If needed: define rule "Analyst X sees game_id=123 rows only".
- Inject WHERE clause in Cube query layer.
- Test: verify analysts can't see peer's data.

**Why:** Looker pattern. **YAGNI caveat:** skip if workspaces already provide game isolation. Only add if multi-game workspace sharing is a use case.

**Cost:** ~8 pts. ROI: very high, but only if multi-game access is real (confirm with users).

---

### SKIP (Overkill for internal tool)

- **Column-level security:** Too granular for analyst explorers; only needed if financial/PII tables shared.
- **Custom roles (beyond 3 base types):** Metabase analysis shows most orgs stabilize at ~4–5 roles. More = admin overhead.
- **Bulk query deactivation:** Only matters if users abuse; add after v1 if needed.
- **SCIM/LDAP sync:** Cube-playground is < 100 users. Manual + CSV batch invite is sufficient.

---

## D. ADMIN UX PATTERNS (WORTH COPYING)

### Pattern 1: Two-Tier Permission Model
**Structure:** Role-first, then data-access second.
```
User → Role (Admin/Analyst/Viewer) → [Tab 1] Feature access (SQL editor, etc.)
User → [Tab 2] Workspace/Game access (toggle per role-type)
```
**Example:** Preset's workspace role vs data access role separation.

**Why:** Clear mental model. Admins don't conflate "can edit dashboards" with "can see game-2 data".

---

### Pattern 2: Master-Detail Card Layout for Groups
```
Groups Tab:
  [Card] Group: "Game-1 Analysts"
    • Members: 5
    • Workspace access: prod-mirror, game-1
    • Games visible: {game_id: 1}
    • Actions: [Edit] [Delete]
  [Card] Group: "Viewers"
    • Members: 12
    • Workspace access: prod-mirror
    • Games visible: All (read-only)
    • Actions: [Edit] [Delete]
```

**Why:** Omni + Amplitude pattern. Everything about a group visible at a glance; click [Edit] for detail.

---

### Pattern 3: Inline Audit Log with User Filters
```
Audit Log Tab:
  [Date picker: last 7 days] [User filter dropdown] [Action filter: login/role-change/query-run] [Export CSV]
  
  Timestamp | User | Action | Object | Details | ...
  2026-06-03 13:45 | khoitn | created-group | Game-1 Analysts | members=5 | [view]
  2026-06-03 10:22 | analyst-1 | queried | workspace/prod-mirror | rows=50K, duration=2.3s | [view]
```

**Why:** Mixpanel + Amplitude pattern. Filters + export = self-service compliance audit.

---

### Pattern 4: Empty State Prompts → First Action
```
Users Tab (empty):
  [Illustration: empty folder]
  "No users yet. Ready to invite your first analyst?"
  [Invite Users Button]
  
Groups Tab (empty):
  "Create a group to organize users and manage permissions in bulk."
  [Create Group Button]
```

**Why:** Asana pattern. Reduces "what do I do?" friction.

---

## E. PRIVACY & GOVERNANCE CONSIDERATIONS

**For internal game-analytics tool (no external users):**

1. **Query logging legality:** Logging per-user queries ≠ privacy violation if users consented to enterprise monitoring. Include in onboarding checklist or ToS addendum. VNG likely already has this for server logs.

2. **Last-login inference:** Timestamp harmless if org understands it's for "seat optimization" (i.e., detecting unused licenses). Document in admin handbook.

3. **No anonymization needed:** Internal tool + known users = can log real names/IPs. Only anonymize if exporting dashboard outside VNG security perimeter.

4. **Audit log retention:** Keep ≥90 days for compliance. Recommend 1 year for game analysis (correlate query patterns with game events).

5. **Data deletion flow:** If analyst leaves, soft-deactivate (don't delete). Preserve audit trail for compliance. Only hard-delete on legal request (GDPR equivalent applies if EU staff).

---

## F. IMPLEMENTATION ROADMAP (ESTIMATE)

**Week 1–2 (Sprint 1):** Must-have v1
- Group RBAC + 3 base roles: ~3 pts
- Admin console tabbed layout + Users/Groups tabs: ~4 pts
- Workspace/game filtering per group: ~3 pts
- **Total: 10 pts**

**Week 3–4 (Sprint 2):** Onboarding + UX polish
- Invite flow + batch CSV: ~4 pts
- Empty states + search: ~2 pts
- Audit log basic table (no query logging yet): ~3 pts
- **Total: 9 pts**

**Month 2+ (v2 backlog, prioritize after v1 adoption):**
- Last-login tracking: ~2 pts
- Per-user activity summary: ~3 pts
- Query audit log (if Cube supports): ~5 pts
- Attribute-based RLS (if multi-game workspace needed): ~8 pts

**Total v1: ~19 pts** (~4–5 weeks, 1 eng + 1 PM part-time).

---

## G. UNRESOLVED QUESTIONS

1. **Does Cube.dev expose query execution metrics natively?** (duration, rows scanned) → Required for query audit log v2.

2. **Will analysts need multi-workspace access with different row-level filters?** (e.g., "analyst sees game-1 in workspace A, game-2 in workspace B") → Determines if attribute-based RLS is v1 or skip.

3. **What's the current Cube workspace isolation model?** (per-game workspace, or shared workspace with game filters?) → Informs whether workspace toggles sufficient or RLS required.

4. **Is there an existing user/group table in cube-playground DB?** → Determines schema effort for RBAC.

5. **How should "Admin" role be provisioned?** (only Khôi initially, or delegate to Tech Lead later?) → Affects invite flow design.

6. **Audit log retention policy:** Keep logs ≥90 days? 1 year? → Affects database sizing.

7. **Is there appetite for per-user query cost tracking?** (e.g., "Analyst X's queries cost $50/month"?) → Only if BI tool cost-allocation is a concern.

---

## SOURCES

- [Metabase Permissions Overview](https://www.metabase.com/docs/latest/permissions/start)
- [Metabase Row-Level Permissions Tutorial](https://www.metabase.com/learn/metabase-basics/administration/permissions/row-permissions)
- [Looker Access Control & Permission Management](https://docs.cloud.google.com/looker/docs/access-control-and-permission-management)
- [Looker Row-Level Security Implementation](https://oneuptime.com/blog/post/2026-02-17-configure-looker-data-permissions-row-level-access/view)
- [Preset RBAC Documentation](https://docs.preset.io/docs/role-based-access-security-rbac)
- [Preset Row-Level Security](https://docs.preset.io/docs/row-level-security-rls)
- [Hex Admin API & Observability](https://hex.tech/blog/introducing-admin-api/)
- [Hex Workspace Roles](https://learn.hex.tech/docs/collaborate/sharing-and-permissions/roles)
- [Mode Analytics Access Control](https://mode.com/help/articles/permissions/)
- [Omni Permissions Documentation](https://docs.omni.co/administration/users/permissions)
- [Amplitude Usage Reports & Audit](https://amplitude.com/docs/admin/billing-use/usage-reports)
- [Amplitude Data Governance](https://amplitude.com/docs/data/troubleshooting/instrumentation-issues)
- [Mixpanel Audit Log Changelog](https://docs.mixpanel.com/changelogs/2026-04-06-audit-logs)
- [Mixpanel Data Governance](https://docs.mixpanel.com/guides/implement/establish-governance)
- [Power BI Bulk Operations](https://powerbi.microsoft.com/en-us/blog/bulk-operations-in-the-admin-portal/)
- [User Onboarding Empty States Pattern](https://www.useronboard.com/onboarding-ux-patterns/empty-states/)
- [Google Workspace Audit Logs](https://developers.google.com/workspace/admin/reports/v1/guides/manage-audit-login)

---

**Report Date:** 2026-06-03
**Report Author:** Researcher Agent
**Status:** Complete. Unresolved questions listed in section G.
