# By-Playbook filters — implementation note (prototype → real CS Dashboard)

Handoff for implementing the three Case-Ledger filters prototyped in
`VIP Care CS Console Flow.html` (this folder) into the live CS Dashboard.

**Prototype reference:** `./VIP Care CS Console Flow.html` → `function Queue(...)`.
Open it, switch to **By Playbook**, to see target behaviour. Screenshot:
`17-multi-playbook.png` (multi-playbook selection + per-playbook column).

**Prototype is mock/illustrative.** It uses design tokens already (Inter, brand,
soft/ink status pairs) so visuals map 1:1 — but data wiring is the real work.

---

## Where this lands in cube-playground

| Concern | Real file |
|---|---|
| Two-lens page (By Playbook / By VIP) | `src/pages/Dashboards/cs/case-ledger.tsx` |
| By-Playbook list hook | `src/pages/Dashboards/cs/use-care-cases.ts` → `useCareCases(gameId, {playbookId?, status?, page, pageSize})` |
| By-VIP queue hook | same file → `useVipQueue(...)` |
| Status pill tokens | `case-ledger.tsx` → `STATUS_STYLE` / `STATUS_LABEL` |
| Pagination | `queue-pager.tsx` |
| Playbook list (for the picker) | `use-care-playbooks.ts` (live + availability-gated) |

Current state: By Playbook is **single** playbook via URL param `?playbook=<id>`;
`status` is an optional **single** value. Backend: `GET /api/care/cases?game=&playbook=&status=`.

⚠️ **Status enum differs from the prototype.** Real `CareCase.status` =
`'new' | 'in_review' | 'treated' | 'resolved' | 'dismissed'`. The prototype only
mocked `new/review/treated`. **Use the real enum** for the status chips (likely
group `resolved`+`dismissed` as a "Closed" chip, or show all five — confirm with PM).

---

## 1. Playbook filter → prominent, multi-select  (the primary filter)

**Goal:** replace the single inline pill with a prominent bordered **Playbooks bar**:
selected playbooks as removable chips + an "Add / change" dropdown (searchable,
checkbox multi-select, stays open while toggling, closes on outside-click). Keep ≥1
selected. When >1 selected, the table gains a **Playbook column**.

**State (lift to URL params — page already uses `useLocation`/`useHistory`):**
- `?playbook=01,04,14` (comma-separated ids). Single id stays back-compatible.
- Parse to `string[]`; `togglePB(id)` add/remove, guard length ≥ 1.

**Data — two options:**
- **(A, preferred)** extend backend `playbook=` to accept comma list →
  `useCareCases` returns combined rows already tagged with `playbook_id`/`playbook_name`.
  One request, server-paged. Requires a small API change.
- **(B, no-backend)** call `useCareCases` per selected id and merge client-side.
  Simpler to ship, but breaks server pagination across playbooks — only acceptable
  for small N. If used, cap N and `log`/note the limitation.

**Table:** render a `Playbook` column only when `selectedPlaybookIds.length > 1`
(`CareCase.playbook_name` already exists). Row `key` must include `playbook_id`
(uids can repeat across playbooks).

**Dropdown source:** `useCarePlaybooks` (live + availability-gated). Exclude
blocked/unavailable playbooks — they have no queue. Group by NHÓM (group field) as
in the prototype.

**Prototype logic to mirror** (`Queue` in the HTML):
```js
const [pbSel,setPbSel]=useState([initialId]);
const togglePB=(id)=>setPbSel(s=>s.includes(id)?(s.length>1?s.filter(x=>x!==id):s):[...s,id]);
const selPBs=livePB.filter(r=>pbSel.includes(r.id));
const multiPB=selPBs.length>1;
const cases=selPBs.flatMap(pb=>casesFor(pb).map((c,i)=>({...c,pbId:pb.id,pbName:pb.name,key:pb.id+'_'+i})));
```
CSS classes in prototype: `.pbbar`, `.pbbar-lbl`, `.pbchip`, `.pbadd`, `.pbsel-menu`,
`.pbsel-item`, `.pbsel-check`, `.pbtag` (translate to the dashboard's styling approach
— `case-ledger.tsx` uses inline `style={{...var(--*)}}`, no CSS classes).

## 2. Status filter → de-emphasized, multi-select

**Goal:** plain chip row (no card chrome) below the Playbooks bar. Chips:
All + one per status, each with a live count, multi-select (accumulate),
checkmark on selected, "Clear (n)". Tints from `STATUS_STYLE`.

**State:** `?status=new,in_review` (comma list). `[]` / absent = all.
**Data:** extend `status=` param to comma list, OR filter client-side on the
returned page. Counts: ideally from a server aggregate; for a quick pass compute
from the current page and label them as page-scoped.

```js
const [stSel,setStSel]=useState([]);
const toggleSt=(k)=>setStSel(s=>s.includes(k)?s.filter(x=>x!==k):[...s,k]);
const shown = stSel.length===0 ? cases : cases.filter(c=>stSel.includes(c.status));
```

## 3. By-VIP lens → search by name / uid

**Goal:** search bar above the By-VIP table; filter on uid **or** display name.
**Gotcha:** confirm `VipCaseRow` carries a human **display name** — prototype added
`name` to mock VIPs, but the real DTO may only have `uid`. If no name field exists,
either (a) add it to `/api/care/cases/by-vip`, or (b) search uid-only and drop the
"by name" copy. **Do not invent a name client-side.**
**Data:** prefer a server `q=` param on the by-vip endpoint (queue can be large and
is server-paged); client-only filter would only search the current page.

---

## Cross-cutting

- **URL as source of truth** for all three filters → shareable/bookmarkable, survives
  refresh, plays with existing `?playbook=` deep links.
- **Tokens only**, no raw hex. Match CS Monitor header pattern (24px 32px padding,
  maxWidth 1320, `var(--font-sans)`).
- **Outside-click close** for the playbook dropdown: use a `mousedown` document
  listener gated on `.closest()` of the dropdown root — **not** a full-screen
  backdrop div (it intercepts clicks on the filter chips; this exact bug bit the
  prototype, see git history of the HTML).
- **Tests:** extend `__tests__/use-care-cases.test.ts` for multi-playbook + multi-status
  params; add a case-ledger render test asserting the Playbook column appears only when
  `selectedPlaybookIds.length > 1`.
- **Empty states:** "No open cases in the selected playbook(s)." vs
  "No cases match the selected status(es)." (prototype wording).

## Open questions
- Status chips: show all 5 statuses, or collapse `resolved`+`dismissed` into "Closed"?
- Backend: add comma-list support to `playbook=`/`status=` and `q=` to by-vip, or
  ship client-side filtering first (N-capped)? Affects pagination correctness.
- Does `VipCaseRow` expose a display name, or is search uid-only for now?
- Per-status counts: server aggregate vs page-scoped (labelled) for the first pass?
