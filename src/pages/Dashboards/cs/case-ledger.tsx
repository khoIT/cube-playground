/**
 * Case Ledger — /dashboards/cs/queue
 *
 * Two-lens view over care_cases:
 *
 *   By Playbook — single-playbook queue (URL param ?playbook=<id>).
 *     Each row shows the stats snapshot captured at match time + state pill.
 *     Row click → Member-360 for that UID.
 *
 *   By VIP (Action Queue) — deduplicated, priority-ranked list via
 *     /api/care/cases/by-vip. One row per VIP; case chips span playbooks.
 *     Contact-fatigue logic lives in Phase 5 — this view shows a neutral
 *     "Last contact" column as a placeholder.
 *
 * Design tokens only (var(--*)). No raw hex. Mirrors CS Monitor page header
 * pattern: 24px 32px padding, maxWidth 1320, margin 0 auto, var(--font-sans).
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useHistory, Link } from 'react-router-dom';
import { ListChecks, Users, ChevronLeft, RefreshCw, Heart, GitCompare, Search, X, Trash2 } from 'lucide-react';
import { useGameContext } from '../../../components/Header/use-game-context';
import { useAuthUser } from '../../../auth/auth-context';
import { useCareCases, useVipQueue, runCareSweep, useSweepStatus, patchCareCase, resetCareCases, fetchFullVipQueue } from './use-care-cases';
import { SweepProgressBanner } from './sweep-progress-banner';
import { toCsv, downloadCsv, buildCsvFilename } from './care-queue-csv';
import type { CsvRow } from './care-queue-csv';
import { claimCase } from './cs-case-actions';
import { CsOwnerChip } from './member360/cs-owner-chip';
import { OutcomeChip } from './member360/cs-care-history-timeline';
import type { CareOutcome } from './member360/cs-member360-mock';
import { QueuePager } from './queue-pager';
import { summarizeSnapshot } from './case-snapshot-summary';
import { SweepsLens } from './sweeps-lens';
import { PlaybookFilterBar } from './playbook-filter-bar';
import { StatusChipRow } from './status-chip-row';
import { orderByMultiMatch, type MatchedPlaybook } from './case-ledger-ordering';
import { VipIdentityCard } from './vip-identity-card';
import type { CareCase, VipCaseRow, CareVipProfileDto } from './use-care-cases';

// ── Shared helpers ────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.floor(ms / 60_000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Full local timestamp for hover tooltips (when exactly the sweep matched). */
function exactTime(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : undefined;
}

// ── Status pill ───────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  new:        { background: 'var(--brand-soft)',       color: 'var(--brand-hover)' },
  in_review:  { background: 'var(--info-soft)',        color: 'var(--info-ink)' },
  treated:    { background: 'var(--success-soft)',     color: 'var(--success-ink)' },
  resolved:   { background: 'var(--success-soft)',     color: 'var(--success-ink)' },
  dismissed:  { background: 'var(--muted-soft)',       color: 'var(--muted-ink)' },
};

const STATUS_LABEL: Record<string, string> = {
  new: 'New', in_review: 'In review', treated: 'Treated',
  resolved: 'Resolved', dismissed: 'Dismissed',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      style={{
        ...(STATUS_STYLE[status] ?? STATUS_STYLE.new),
        display: 'inline-block',
        fontSize: 10.5,
        fontWeight: 700,
        padding: '3px 9px',
        borderRadius: 'var(--radius-full)',
        whiteSpace: 'nowrap',
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ── Matched-playbook pill — names the playbook this case fired against ──────────

/**
 * Priority-tinted pill naming the matched playbook. Clicking opens that playbook's
 * definition (the builder in edit mode) so an analyst can inspect the threshold and
 * action that fired this case — distinct from the row click, which opens the VIP's
 * Member-360. The deciding stats snapshot moves into the hover tooltip so the triage
 * context isn't lost.
 */
function MatchedPlaybookPill({ c, gameId }: { c: CareCase; gameId: string }) {
  const name = c.playbook_name ?? c.playbook_id;
  const tint = PRIO[prioOf(c.playbook_priority ?? 'tb')].badge;
  const snapshot = summarizeSnapshot(c.stats_snapshot_json);
  const tip = snapshot ? `Open playbook definition · matched: ${snapshot}` : 'Open playbook definition';
  return (
    <Link
      to={`/dashboards/cs/playbooks/${encodeURIComponent(c.playbook_id)}/edit?game=${encodeURIComponent(gameId)}`}
      onClick={(e) => e.stopPropagation()}
      title={tip}
      style={{
        ...tint,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 11, fontWeight: 600, padding: '3px 10px',
        borderRadius: 'var(--radius-full)', whiteSpace: 'nowrap',
        textDecoration: 'none', fontFamily: 'var(--font-sans)',
        maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      {name}
    </Link>
  );
}

/**
 * Compact secondary chip for a playbook the same VIP *also* matched among the
 * selected set (the row's own playbook renders as the primary pill). Muted with
 * a priority dot so the cross-match reads as context, not the row's subject;
 * still a link to that playbook's definition.
 */
function SiblingPlaybookChip({ pb, gameId }: { pb: MatchedPlaybook; gameId: string }) {
  return (
    <Link
      to={`/dashboards/cs/playbooks/${encodeURIComponent(pb.id)}/edit?game=${encodeURIComponent(gameId)}`}
      onClick={(e) => e.stopPropagation()}
      title={`Also matches: ${pb.name} — open its definition`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 10.5, fontWeight: 600, padding: '2px 8px',
        borderRadius: 'var(--radius-full)', whiteSpace: 'nowrap',
        background: 'var(--muted-soft)', color: 'var(--muted-ink)',
        textDecoration: 'none', fontFamily: 'var(--font-sans)',
        maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIO[prioOf(pb.priority ?? 'tb')].dot, flexShrink: 0 }} />
      {pb.name}
    </Link>
  );
}

// ── Multi-match badge — VIP matches >1 of the selected playbooks ────────────────

/**
 * Flags a VIP whose open cases span several of the selected playbooks. These rows
 * are promoted to the top of the By-Playbook view (they have multiple concurrent
 * problems → highest triage value), and the badge makes that promotion legible.
 */
function MultiMatchBadge({ count }: { count: number }) {
  return (
    <span
      style={{
        fontSize: 10,
        background: 'var(--info-soft)',
        color: 'var(--info-ink)',
        borderRadius: 'var(--radius-full)',
        padding: '1px 7px',
        fontWeight: 700,
        marginLeft: 6,
        whiteSpace: 'nowrap',
      }}
      title={`Matches ${count} of the selected playbooks`}
    >
      {count} playbooks
    </span>
  );
}

// ── Lapsed badge ──────────────────────────────────────────────────────────────

function LapsedBadge() {
  return (
    <span
      style={{
        fontSize: 10,
        background: 'var(--warning-soft)',
        color: 'var(--warning-ink)',
        borderRadius: 'var(--radius-full)',
        padding: '1px 6px',
        fontWeight: 600,
        marginLeft: 6,
      }}
      title="The triggering condition has since lapsed."
    >
      lapsed
    </span>
  );
}

// ── Priority palette (badge tint + dot color), keyed by registry priority ──────

type Prio = 'cao' | 'tb' | 'thap';

const PRIO: Record<Prio, { badge: React.CSSProperties; dot: string; label: string }> = {
  cao:  { badge: { background: 'var(--destructive-soft)', color: 'var(--destructive-ink)' }, dot: 'var(--danger)', label: 'Cao' },
  tb:   { badge: { background: 'var(--info-soft)', color: 'var(--info-ink)' },               dot: 'var(--info)',   label: 'TB' },
  thap: { badge: { background: 'var(--muted-soft)', color: 'var(--muted-ink)' },             dot: 'var(--border-strong)', label: 'Thấp' },
};

function prioOf(p: number | string): Prio {
  const s = String(p);
  if (s === 'cao' || Number(p) <= 2) return 'cao';
  if (s === 'tb' || Number(p) <= 4) return 'tb';
  return 'thap';
}

// Recent treatment within this window flips a VIP to a contact-fatigue "cap":
// the next outreach is deferred so the same whale isn't pinged twice in a day.
const FATIGUE_WINDOW_MS = 24 * 3_600_000;

// ── Shared table styles ───────────────────────────────────────────────────────

const cellBase: React.CSSProperties = {
  padding: '10px 16px',
  borderBottom: '1px solid var(--border-card)',
  fontSize: 12.5,
  verticalAlign: 'middle',
  fontFamily: 'var(--font-sans)',
};

const thStyle: React.CSSProperties = {
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-muted)',
  fontWeight: 600,
  textAlign: 'left',
  padding: '8px 16px',
  borderBottom: '1px solid var(--border-card)',
  background: 'var(--bg-card)',
  fontFamily: 'var(--font-sans)',
};

// ── Shared action-button styles ─────────────────────────────────────────────
// One equal-height cluster across both lenses: a ghost secondary (Claim) and a
// brand primary (Open 360 / Take care), with a muted disabled state (Deferred).

const actionBtnBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 28,
  padding: '0 12px',
  fontSize: 11.5,
  fontWeight: 600,
  fontFamily: 'var(--font-sans)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid transparent',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  lineHeight: 1,
};

const ghostBtn: React.CSSProperties = {
  ...actionBtnBase,
  background: 'transparent',
  borderColor: 'var(--border-strong)',
  color: 'var(--text-secondary)',
};

const primaryBtn: React.CSSProperties = {
  ...actionBtnBase,
  background: 'var(--brand)',
  borderColor: 'var(--brand)',
  color: '#fff',
};

const disabledBtn: React.CSSProperties = {
  ...actionBtnBase,
  background: 'var(--bg-card)',
  borderColor: 'var(--border-card)',
  color: 'var(--text-muted)',
  opacity: 0.6,
  cursor: 'not-allowed',
};

// ── By-Playbook table ─────────────────────────────────────────────────────────

interface PlaybookRowProps {
  c: CareCase;
  gameId: string;
  /** segment id used to build the Member-360 link; absent when navigating from queue */
  segId?: string;
  /** How many of the selected playbooks this VIP matches (>1 → multi-match badge). */
  matchCount?: number;
  /** Other selected playbooks this VIP also matches (excludes the row's own). */
  siblings?: MatchedPlaybook[];
  /** Current user's identity string for the owner chip comparison. */
  me?: string | null;
  /** True when user may claim cases. */
  canWrite?: boolean;
  /** Called after a successful claim — parent re-fetches its list. */
  onClaim?: () => void;
}

function PlaybookCaseRow({ c, gameId, segId, matchCount = 1, siblings = [], me, canWrite, onClaim }: PlaybookRowProps) {
  const profile = c.profile;
  const history = useHistory();
  // Member-360 links to the segment-member view when a segment id is known;
  // otherwise the standalone care route carries the game on the URL.
  const path = segId
    ? `/segments/${segId}/members/${encodeURIComponent(c.uid)}`
    : `/dashboards/cs/members/${encodeURIComponent(c.uid)}?game=${encodeURIComponent(gameId)}`;

  const isOpen = c.status === 'new' || c.status === 'in_review';

  function handleClaim(e: React.MouseEvent) {
    // Prevent the row-click navigation when the claim button is clicked.
    e.stopPropagation();
    if (!me || !canWrite || !isOpen) return;
    claimCase(c.id, me).then(() => onClaim?.()).catch(() => {});
  }

  return (
    <tr
      onClick={() => history.push(path)}
      style={{ cursor: 'pointer', transition: 'background 0.12s' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--brand-soft)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = ''; }}
    >
      {/* VIP identity card — name + tier badge + LTV·tier + churn */}
      <td style={cellBase}>
        <VipIdentityCard
          uid={c.uid}
          profile={profile}
          trailing={
            <>
              {matchCount > 1 && <MultiMatchBadge count={matchCount} />}
              {c.condition_lapsed === 1 && <LapsedBadge />}
            </>
          }
        />
      </td>
      {/* Matched Playbook: the row's own playbook (primary pill) plus compact
          chips for the other selected playbooks this VIP also matches, so the
          multi-match that floated the VIP to the top is legible in the column. */}
      <td style={cellBase}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5 }}>
          <MatchedPlaybookPill c={c} gameId={gameId} />
          {siblings.map((pb) => (
            <SiblingPlaybookChip key={pb.id} pb={pb} gameId={gameId} />
          ))}
        </div>
      </td>
      {/* State — resolved rows also show a KPI outcome badge when present */}
      <td style={cellBase}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <StatusPill status={c.status} />
          {c.status === 'resolved' && c.outcome && (c.outcome === 'kpi_met' || c.outcome === 'kpi_missed') && (
            <OutcomeChip outcome={c.outcome as CareOutcome} />
          )}
        </div>
      </td>
      {/* Matched (when the sweep opened this case) */}
      <td
        style={{ ...cellBase, color: 'var(--text-muted)', fontSize: 11.5 }}
        title={exactTime(c.opened_at ?? c.created_at ?? null)}
      >
        {relativeTime(c.opened_at ?? c.created_at ?? null)}
      </td>
      {/* Action: Open 360 + inline claim/owner chip for open cases */}
      <td style={{ ...cellBase, textAlign: 'right', width: 190 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          {/* Owner chip — shows who owns this open case */}
          {isOpen && c.assignee && (
            <CsOwnerChip assignee={c.assignee} me={me} />
          )}
          {/* Claim button for open unowned cases (or re-claim for writers) */}
          {isOpen && canWrite && me && (
            <button
              type="button"
              onClick={handleClaim}
              title={c.assignee ? 'Re-assign to yourself' : 'Claim this case'}
              style={ghostBtn}
            >
              Claim
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); history.push(path); }}
            style={primaryBtn}
          >
            Open 360 →
          </button>
        </div>
      </td>
    </tr>
  );
}

interface ByPlaybookViewProps {
  gameId: string;
  /** Selected playbook ids (URL source of truth). [] = all playbooks. */
  playbookIds: string[];
  onTogglePlaybook: (id: string) => void;
  /** Selected statuses; [] = all. Applied client-side as a page refinement. */
  statuses: string[];
  onToggleStatus: (s: string) => void;
  onClearStatus: () => void;
  /** Called once on mount so the parent can trigger a refetch after a reset. */
  onRegisterRefetch?: (fn: () => void) => void;
  /** Notifies the parent of the current server-side total (used for the reset dialog label). */
  onTotalChange?: (n: number) => void;
}

function ByPlaybookView({
  gameId,
  playbookIds,
  onTogglePlaybook,
  statuses,
  onToggleStatus,
  onClearStatus,
  onRegisterRefetch,
  onTotalChange,
}: ByPlaybookViewProps) {
  const user = useAuthUser();
  const canWrite = user?.role === 'editor' || user?.role === 'admin';
  const me = user ? (user.username ?? user.email ?? null) : null;

  // Cases arrive pre-enriched with the persisted VIP profile + matched-playbook
  // name — no live Cube call. Pagination is server-side per the selected
  // playbooks; the status chips refine the current page client-side so their
  // counts stay honest ("on page").
  const [page, setPage] = useState(1);
  const pbKey = playbookIds.join(',');
  useEffect(() => setPage(1), [gameId, pbKey]); // reset on game / playbook-set switch
  const { status, cases, error, total, pageSize, refetch } = useCareCases(gameId, { playbookIds, page });
  // Re-fetch after a claim so the owner chip updates immediately without navigation.
  const handleClaim = useCallback(() => refetch(), [refetch]);

  // Register refetch with the parent so a reset can immediately clear stale rows
  // without a full page reload. Runs once on mount; stable refetch identity means
  // it won't re-register on every render.
  useEffect(() => {
    onRegisterRefetch?.(refetch);
  // onRegisterRefetch is provided by the parent once (stable callback ref setter);
  // refetch identity is stable across renders (defined with useCallback).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch]);

  // Keep the parent's reset-dialog count in sync with what the server reports as
  // the current total — no extra fetch needed, the list response carries it.
  useEffect(() => {
    onTotalChange?.(total);
  }, [total, onTotalChange]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of cases) m[c.status] = (m[c.status] ?? 0) + 1;
    return m;
  }, [cases]);
  const shown = useMemo(
    () => (statuses.length === 0 ? cases : cases.filter((c) => statuses.includes(c.status))),
    [cases, statuses],
  );

  // Multi-playbook promotion: when more than one playbook is selected, float VIPs
  // matching several of them to the top (highest-value triage), tie-broken by
  // priority then recency. Page-scoped, in lock-step with the on-page counts.
  const multi = playbookIds.length > 1;
  const { ordered, matchCountByUid, matchedPlaybooksByUid } = useMemo(
    () => orderByMultiMatch(shown, multi),
    [shown, multi],
  );

  // Export: fetch the FULL un-paginated VIP queue (no page params → server
  // returns all rows), map to CSV columns, and trigger a browser download.
  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(async () => {
    if (!gameId || exporting) return;
    setExporting(true);
    try {
      const vips = await fetchFullVipQueue(gameId);
      const csvRows: CsvRow[] = vips.map((v) => ({
        uid: v.uid,
        name: v.profile?.name ?? null,
        ltvVnd: v.profile?.ltvVnd ?? null,
        tier: v.profile?.tier ?? null,
        topPlaybook: v.playbooks[0]?.name ?? null,
        openCaseCount: v.caseCount,
        lastContact: v.lastTreatedAt,
        status: v.cases[0]?.status ?? '',
      }));
      downloadCsv(buildCsvFilename(gameId), toCsv(csvRows));
    } finally {
      setExporting(false);
    }
  }, [gameId, exporting]);

  return (
    <div>
      {/* Filters + Export */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderBottom: '1px solid var(--border-card)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <PlaybookFilterBar gameId={gameId} selected={playbookIds} onToggle={onTogglePlaybook} />
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            title="Download full VIP queue as CSV (all pages, GMT+7 timestamp)"
            style={{
              flexShrink: 0,
              fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-sans)',
              color: 'var(--text-secondary)', background: 'var(--bg-card)',
              border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)',
              padding: '5px 12px', cursor: exporting ? 'wait' : 'pointer',
              opacity: exporting ? 0.6 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {exporting ? 'Exporting…' : '↓ Export CSV'}
          </button>
        </div>
        <StatusChipRow selected={statuses} onToggle={onToggleStatus} onClear={onClearStatus} counts={counts} />
      </div>

      {status === 'error' ? (
        <div style={{ margin: 16, padding: 16, background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', borderRadius: 'var(--radius-md)', fontSize: 13 }}>
          Failed to load cases: {error}
        </div>
      ) : status === 'idle' || status === 'loading' ? (
        <LoadingRows />
      ) : cases.length === 0 ? (
        <EmptyState label="No open cases in the selected playbook(s)." />
      ) : shown.length === 0 ? (
        <EmptyState label="No cases match the selected status(es)." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: '24%' }}>VIP</th>
                <th style={thStyle}>Matched Playbook</th>
                <th style={thStyle}>State</th>
                <th style={thStyle}>Matched</th>
                <th style={{ ...thStyle, width: 190 }} aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {ordered.map((c) => (
                // uids repeat across playbooks → key must include the playbook id.
                <PlaybookCaseRow
                  key={`${c.playbook_id}_${c.id}`}
                  c={c}
                  gameId={gameId}
                  matchCount={multi ? (matchCountByUid.get(c.uid) ?? 1) : 1}
                  siblings={
                    multi
                      ? (matchedPlaybooksByUid.get(c.uid) ?? []).filter((pb) => pb.id !== c.playbook_id)
                      : []
                  }
                  me={me}
                  canWrite={canWrite}
                  onClaim={handleClaim}
                />
              ))}
            </tbody>
          </table>
          <QueuePager page={page} pageSize={pageSize} total={total} onPage={setPage} unit="cases" />
        </div>
      )}
    </div>
  );
}

// ── By-VIP table (action queue) ───────────────────────────────────────────────

interface VipRowProps {
  row: VipCaseRow;
  gameId: string;
  me?: string | null;
  canWrite?: boolean;
  onClaim?: () => void;
}

function VipQueueRow({ row, gameId, me, canWrite, onClaim }: VipRowProps) {
  const history = useHistory();
  const profile: CareVipProfileDto | null | undefined = row.profile;
  const base = `/dashboards/cs/members/${encodeURIComponent(row.uid)}?game=${encodeURIComponent(gameId)}`;
  const go = (toCare: boolean) => history.push(toCare ? `${base}&tab=care` : base);

  // Top-priority open case drives the claim target (highest urgency for this VIP).
  const topOpenCase = row.cases.find((c) => c.status === 'new' || c.status === 'in_review');

  function handleClaim(e: React.MouseEvent) {
    e.stopPropagation();
    if (!me || !canWrite || !topOpenCase) return;
    claimCase(topOpenCase.id, me).then(() => onClaim?.()).catch(() => {});
  }

  // Top-priority playbook drives the named pill; row priority drives its tint.
  const topPb = row.playbooks.find((pb) => pb.priority === row.topPriority) ?? row.playbooks[0];
  const topPrio = prioOf(row.topPriority);

  // Contact-fatigue guard: a VIP treated within the window defers the next reach.
  const lastMs = row.lastTreatedAt ? Date.now() - new Date(row.lastTreatedAt).getTime() : null;
  const fatigued = lastMs != null && Number.isFinite(lastMs) && lastMs < FATIGUE_WINDOW_MS;

  return (
    <tr
      onClick={() => go(false)}
      style={{ cursor: 'pointer', transition: 'background 0.12s' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--brand-soft)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = ''; }}
    >
      {/* VIP identity */}
      <td style={{ ...cellBase, width: '24%' }}>
        <VipIdentityCard uid={row.uid} profile={profile} />
      </td>

      {/* Open cases across playbooks — dot-chips, ✓ when that playbook is treated */}
      <td style={cellBase}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {row.playbooks.map((pb) => {
            const pbCases = row.cases.filter((c) => c.playbook_id === pb.id);
            const treated = pbCases.length > 0 && pbCases.every((c) => c.status === 'treated' || c.status === 'resolved');
            return (
              <span
                key={pb.id}
                title={`${pb.name}: ${pbCases.length} case(s)`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 11, fontWeight: 600, padding: '3px 8px',
                  borderRadius: 'var(--radius-full)', background: 'var(--bg-muted)',
                  color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)',
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: PRIO[prioOf(pb.priority)].dot }} />
                {pb.name}{treated && ' ✓'}
              </span>
            );
          })}
        </div>
      </td>

      {/* Top priority — named playbook pill tinted by priority */}
      <td style={cellBase}>
        <span
          style={{
            ...PRIO[topPrio].badge,
            display: 'inline-flex', alignItems: 'center',
            fontSize: 10.5, fontWeight: 600, padding: '3px 9px',
            borderRadius: 'var(--radius-full)', whiteSpace: 'nowrap',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {topPb?.name ?? PRIO[topPrio].label}
        </span>
      </td>

      {/* Last contact — fatigue cap when treated within the window */}
      <td style={{ ...cellBase, fontSize: 11.5 }}>
        {fatigued ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--warning-ink)', fontWeight: 600 }}>
            <RefreshCw size={12} aria-hidden /> {relativeTime(row.lastTreatedAt)} · cap
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>{relativeTime(row.lastTreatedAt)}</span>
        )}
      </td>

      {/* Action — Claim + owner chip + Take care / Deferred */}
      <td style={{ ...cellBase, textAlign: 'right', width: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          {/* Owner chip for the top open case */}
          {topOpenCase?.assignee && (
            <CsOwnerChip assignee={topOpenCase.assignee} me={me} />
          )}
          {/* Claim button for writers when there is an open case */}
          {topOpenCase && canWrite && me && (
            <button
              type="button"
              onClick={handleClaim}
              title={topOpenCase.assignee ? 'Re-assign to yourself' : 'Claim this case'}
              style={ghostBtn}
            >
              Claim
            </button>
          )}
          {fatigued ? (
            <button
              type="button"
              disabled
              title="Contacted recently — outreach deferred by the contact-fatigue guard"
              style={disabledBtn}
            >
              Deferred
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); go(true); }}
              style={primaryBtn}
              title="Open the member 360 Care tab to log a treatment"
            >
              Take care →
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

interface ByVipViewProps {
  gameId: string;
  /** Called once on mount so the parent can trigger a refetch after a reset. */
  onRegisterRefetch?: (fn: () => void) => void;
  /** Notifies the parent of the current server-side total (used for the reset dialog label). */
  onTotalChange?: (n: number) => void;
}

function ByVipView({ gameId, onRegisterRefetch, onTotalChange }: ByVipViewProps) {
  const user = useAuthUser();
  const canWrite = user?.role === 'editor' || user?.role === 'admin';
  const me = user ? (user.username ?? user.email ?? null) : null;

  // Rows arrive pre-enriched with the persisted VIP profile (name / LTV / tier /
  // churn) from the sweep — SQLite read, no live Cube. Un-swept VIPs show dashes.
  // Paginated 50/page; the priority sort happens server-side before the slice,
  // so page 1 always holds the most urgent VIPs. Search runs server-side (q=) so
  // a name on page 3 is still found.
  const [page, setPage] = useState(1);
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => setPage(1), [gameId]); // reset on game switch
  // Debounce the keystrokes → one request per ~250ms pause; reset to page 1.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setQ(input.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(id);
  }, [input]);
  const { status, vips, error, total, pageSize, refetch } = useVipQueue(gameId, { page, q });
  // Re-fetch after a claim so the owner chip updates immediately.
  const handleClaim = useCallback(() => refetch(), [refetch]);

  // Register refetch with the parent so a reset can immediately clear stale rows
  // without a full page reload (same pattern as ByPlaybookView).
  useEffect(() => {
    onRegisterRefetch?.(refetch);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch]);

  // Keep the parent's reset-dialog count in sync with what the server reports.
  useEffect(() => {
    onTotalChange?.(total);
  }, [total, onTotalChange]);

  // Export: fetch the FULL un-paginated VIP queue (no page params → all rows).
  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(async () => {
    if (!gameId || exporting) return;
    setExporting(true);
    try {
      const allVips = await fetchFullVipQueue(gameId);
      const csvRows: CsvRow[] = allVips.map((v) => ({
        uid: v.uid,
        name: v.profile?.name ?? null,
        ltvVnd: v.profile?.ltvVnd ?? null,
        tier: v.profile?.tier ?? null,
        topPlaybook: v.playbooks[0]?.name ?? null,
        openCaseCount: v.caseCount,
        lastContact: v.lastTreatedAt,
        status: v.cases[0]?.status ?? '',
      }));
      downloadCsv(buildCsvFilename(gameId), toCsv(csvRows));
    } finally {
      setExporting(false);
    }
  }, [gameId, exporting]);

  const searchBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 16, borderBottom: '1px solid var(--border-card)' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, flex: 1, maxWidth: 380,
          padding: '7px 11px', background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-card)',
        }}
      >
        <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search uid or name"
          style={{
            flex: 1, border: 0, outline: 'none', background: 'transparent',
            fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--text-primary)',
          }}
        />
        {input && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setInput('')}
            style={{ display: 'inline-flex', border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {/* Export full queue — bypasses current page and search filter */}
      <button
        type="button"
        onClick={handleExport}
        disabled={exporting}
        title="Download the full VIP queue as CSV (all pages, GMT+7 timestamp)"
        style={{
          flexShrink: 0,
          fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-sans)',
          color: 'var(--text-secondary)', background: 'var(--bg-card)',
          border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)',
          padding: '5px 12px', cursor: exporting ? 'wait' : 'pointer',
          opacity: exporting ? 0.6 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {exporting ? 'Exporting…' : '↓ Export CSV'}
      </button>
    </div>
  );

  let body: React.ReactNode;
  if (status === 'error') {
    body = (
      <div style={{ margin: 16, padding: 16, background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', borderRadius: 'var(--radius-md)', fontSize: 13 }}>
        Failed to load VIP queue: {error}
      </div>
    );
  } else if (status === 'idle' || status === 'loading') {
    body = <LoadingRows />;
  } else if (vips.length === 0) {
    body = <EmptyState label={q ? `No VIPs match “${q}”.` : 'No open VIP cases.'} />;
  } else {
    body = (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: '24%' }}>VIP</th>
              <th style={thStyle}>Open cases (cross-playbook)</th>
              <th style={thStyle}>Top priority</th>
              <th style={thStyle}>Last contact</th>
              <th style={{ ...thStyle, width: 200 }} aria-label="Action" />
            </tr>
          </thead>
          <tbody>
            {vips.map((row) => (
              <VipQueueRow
                key={row.uid}
                row={row}
                gameId={gameId}
                me={me}
                canWrite={canWrite}
                onClaim={handleClaim}
              />
            ))}
          </tbody>
        </table>
        <QueuePager page={page} pageSize={pageSize} total={total} onPage={setPage} unit="VIPs" />
      </div>
    );
  }

  return (
    <div>
      {searchBar}
      {body}
    </div>
  );
}

// ── Utility sub-components ────────────────────────────────────────────────────

function LoadingRows() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          style={{
            height: 36,
            background: 'var(--bg-muted)',
            borderRadius: 'var(--radius-md)',
            opacity: 0.6,
          }}
        />
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-sans)' }}>
      {label}
    </div>
  );
}

// ── Lens toggle ───────────────────────────────────────────────────────────────

type Lens = 'playbook' | 'vip' | 'sweeps';

interface LensToggleProps {
  active: Lens;
  onSwitch: (l: Lens) => void;
}

function LensToggle({ active, onSwitch }: LensToggleProps) {
  const btn = (lens: Lens, label: string) => {
    const on = active === lens;
    return (
      <button
        key={lens}
        type="button"
        onClick={() => onSwitch(lens)}
        style={{
          border: 0,
          borderRadius: 'var(--radius-sm)',
          padding: '6px 13px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          background: on ? 'var(--bg-card)' : 'transparent',
          color: on ? 'var(--text-primary)' : 'var(--text-muted)',
          boxShadow: on ? 'var(--shadow-sm)' : 'none',
          fontFamily: 'var(--font-sans)',
          transition: 'background 0.12s',
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div style={{ display: 'inline-flex', background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)', padding: 3, gap: 2 }}>
      {btn('playbook', 'By Playbook')}
      {btn('vip', 'By VIP (action queue)')}
      {btn('sweeps', 'Sweeps')}
    </div>
  );
}

// ── Reset confirm dialog ──────────────────────────────────────────────────────

interface ResetConfirmDialogProps {
  gameId: string;
  /** Estimated case count shown in the dialog; 0 when unknown. */
  caseCount: number;
  onConfirm: (resweep: boolean) => void;
  onCancel: () => void;
}

/**
 * Modal confirm dialog for the destructive reset action. Mandatory before any
 * wipe: names the game and the case count so the operator knows exactly what
 * will be deleted. The resweep checkbox is OFF by default per spec — the
 * operator opts in only when they want to refill the queue immediately.
 */
function ResetConfirmDialog({ gameId, caseCount, onConfirm, onCancel }: ResetConfirmDialogProps) {
  const [resweep, setResweep] = React.useState(false);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-dialog-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
      }}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.18))',
          padding: '28px 32px',
          maxWidth: 440,
          width: '100%',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Trash2 size={18} style={{ color: 'var(--destructive-ink)', flexShrink: 0 }} aria-hidden />
          <h2
            id="reset-dialog-title"
            style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}
          >
            Reset demo data
          </h2>
        </div>

        <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--text-secondary)' }}>
          This will permanently delete
          {caseCount > 0 ? (
            <b style={{ color: 'var(--destructive-ink)' }}> {caseCount} case{caseCount !== 1 ? 's' : ''} </b>
          ) : (
            ' all cases '
          )}
          for <b style={{ color: 'var(--text-primary)' }}>{gameId}</b>. This cannot be undone.
        </p>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--text-muted)' }}>
          VIP profiles are preserved — only case rows are removed.
        </p>

        {/* Resweep option — OFF by default */}
        <label
          style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            fontSize: 13, color: 'var(--text-secondary)', marginBottom: 22,
          }}
        >
          <input
            type="checkbox"
            checked={resweep}
            onChange={(e) => setResweep(e.target.checked)}
            style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--brand)' }}
          />
          Re-sweep immediately after reset (populates the queue from the live Cube)
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)',
              padding: '7px 16px', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-muted)', border: '1px solid var(--border-card)',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(resweep)}
            style={{
              fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)',
              padding: '7px 16px', borderRadius: 'var(--radius-md)',
              background: 'var(--destructive-soft)', border: '1px solid var(--destructive-ink)',
              color: 'var(--destructive-ink)', cursor: 'pointer',
            }}
          >
            Delete {caseCount > 0 ? `${caseCount} case${caseCount !== 1 ? 's' : ''}` : 'cases'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1320,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

/**
 * CaseLedgerPage — mounted at /dashboards/cs/queue.
 *
 * URL params:
 *   ?playbook=<id>   → pre-selects By-Playbook lens for that playbook.
 *   ?game=<id>       → overrides the active game (optional; defaults to context).
 *
 * Clicking a UID navigates to the segment-less Member-360 at
 * /dashboards/cs/members/:uid?game=<id>.
 */
export function CaseLedgerPage() {
  const location = useLocation();
  const history = useHistory();
  const { gameId: ctxGame } = useGameContext();

  const user = useAuthUser();
  const canWrite = user?.role === 'editor' || user?.role === 'admin';

  const params = new URLSearchParams(location.search);
  const playbookParam = params.get('playbook') ?? '';
  const statusParam = params.get('status') ?? '';
  const gameParam = params.get('game') ?? '';
  const gameId = gameParam || ctxGame;

  // Filters live in the URL → shareable, refresh-safe, deep-link compatible.
  const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const playbookIds = useMemo(() => csv(playbookParam), [playbookParam]);
  const statuses = useMemo(() => csv(statusParam), [statusParam]);

  // Rewrite a single URL filter param in place (preserving the others).
  const setParam = useCallback(
    (key: string, values: string[]) => {
      const next = new URLSearchParams(location.search);
      if (values.length) next.set(key, values.join(','));
      else next.delete(key);
      history.replace({ ...location, search: next.toString() });
    },
    [history, location],
  );
  const togglePlaybook = useCallback(
    (id: string) => setParam('playbook', playbookIds.includes(id) ? playbookIds.filter((x) => x !== id) : [...playbookIds, id]),
    [playbookIds, setParam],
  );
  const toggleStatus = useCallback(
    (s: string) => setParam('status', statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]),
    [statuses, setParam],
  );
  const clearStatus = useCallback(() => setParam('status', []), [setParam]);

  // ── Reset state ───────────────────────────────────────────────────────────
  // Holds the confirm-dialog open/close state and the rough case count to show
  // in the dialog. The count comes from the active view's server-reported total
  // (updated via onTotalChange callback below) — no extra fetch needed; the
  // server returns the exact deleted count in the response anyway.
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetCaseCount, setResetCaseCount] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  // Refs holding the refetch functions registered by the currently mounted child
  // views. Both lenses mount simultaneously (only one is visible), so both refs
  // are populated and called after reset — ensuring the just-hidden lens is also
  // refreshed when the user switches back without a page reload.
  const refetchQueueRef = useRef<(() => void) | null>(null);
  const refetchPortfolioRef = useRef<(() => void) | null>(null);

  // Stable setter callbacks passed into child views as props. Using useCallback
  // with [] avoids triggering the child effects on every parent render.
  const registerQueueRefetch = useCallback((fn: () => void) => { refetchQueueRef.current = fn; }, []);
  const registerPortfolioRefetch = useCallback((fn: () => void) => { refetchPortfolioRef.current = fn; }, []);
  // Mirror the active view's total into resetCaseCount so the dialog always
  // shows the real number. Both lenses call this; the last-rendered one wins
  // (they share the same state slot — fine because only one is visible at a time).
  const handleTotalChange = useCallback((n: number) => setResetCaseCount(n), []);

  const handleOpenResetDialog = useCallback(() => {
    setResetDialogOpen(true);
    setResetMsg(null);
  }, []);

  const handleResetConfirm = useCallback(async (resweep: boolean) => {
    if (!gameId) return;
    setResetDialogOpen(false);
    setResetting(true);
    setResetMsg(null);
    try {
      const r = await resetCareCases(gameId, { resweep });
      const label = resweep && r.reswept
        ? `Reset complete — ${r.deleted} case${r.deleted !== 1 ? 's' : ''} deleted; re-sweep opened ${r.reswept.opened}.`
        : `Reset complete — ${r.deleted} case${r.deleted !== 1 ? 's' : ''} deleted.`;
      setResetMsg(label);
      // Trigger re-fetches in both views so the queue/portfolio clear immediately.
      refetchQueueRef.current?.();
      refetchPortfolioRef.current?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reset failed.';
      setResetMsg(`Reset failed: ${msg}`);
    } finally {
      setResetting(false);
    }
  }, [gameId]);

  // On-demand sweep: populate the ledger from the live Cube. Reloads on success
  // (cases opened) so the queue reflects new rows; surfaces 0-opened / errors inline.
  const [sweeping, setSweeping] = useState(false);
  const [sweepMsg, setSweepMsg] = useState<string | null>(null);
  const handleSweep = useCallback(async () => {
    if (!gameId) return;
    setSweeping(true);
    setSweepMsg(null);
    try {
      const r = await runCareSweep(gameId);
      if (r.opened > 0) {
        window.location.reload();
        return;
      }
      setSweepMsg(`Swept — 0 cases opened (no VIPs currently qualify for ${gameId}).`);
    } catch (err) {
      setSweepMsg(err instanceof Error ? `Sweep failed: ${err.message}` : 'Sweep failed.');
    } finally {
      setSweeping(false);
    }
  }, [gameId]);

  // Reconnect to a sweep that's running but wasn't started by this mount: one
  // launched here then navigated away from, the 6h auto-sweep cron, or another
  // tab. handleSweep manages its own completion (reload-on-opened / inline 0-opened
  // message), so only auto-refresh on settle when this mount isn't itself sweeping —
  // otherwise we'd clobber that inline message.
  const sweepingRef = useRef(sweeping);
  sweepingRef.current = sweeping;
  const sweepStatus = useSweepStatus(
    gameId,
    useCallback(() => {
      if (!sweepingRef.current) window.location.reload();
    }, []),
  );
  const reconnectedSweep = sweepStatus.inFlight && !sweeping;

  // Ticking clock so the live banner can show elapsed seconds while a sweep runs.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!reconnectedSweep) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [reconnectedSweep]);
  const sweepElapsedS = sweepStatus.startedAt
    ? Math.max(0, Math.round((nowMs - new Date(sweepStatus.startedAt).getTime()) / 1000))
    : 0;

  // Determine initial lens from URL.
  const initialLens: Lens = playbookParam ? 'playbook' : 'vip';
  const [lens, setLens] = useState<Lens>(initialLens);

  const handleLensSwitch = useCallback(
    (l: Lens) => {
      setLens(l);
      // Preserve game param but drop the playbook/status filters on other lenses.
      const next = new URLSearchParams(location.search);
      if (l !== 'playbook') {
        next.delete('playbook');
        next.delete('status');
      }
      history.replace({ ...location, search: next.toString() });
    },
    [history, location],
  );

  return (
    <div style={pageStyle}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <Link
            to="/dashboards/cs"
            style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)', marginRight: 4 }}
            title="Back to CS Monitor"
          >
            <ChevronLeft size={16} />
          </Link>
          {lens === 'vip'
            ? <Users size={24} color="var(--brand)" />
            : lens === 'sweeps'
              ? <GitCompare size={24} color="var(--brand)" />
              : <ListChecks size={24} color="var(--brand)" />}
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
            {lens === 'vip'
              ? 'VIP Action Queue'
              : lens === 'sweeps'
                ? 'Sweep History'
                : `Case Ledger${playbookIds.length === 1 ? ` · ${playbookIds[0]}` : playbookIds.length > 1 ? ` · ${playbookIds.length} playbooks` : ''}`}
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Run sweep — editor/admin only; populates the ledger from the live Cube. */}
          {canWrite && (
            <button
              type="button"
              onClick={handleSweep}
              disabled={sweeping || reconnectedSweep}
              title={
                reconnectedSweep
                  ? 'A sweep is already running for this game'
                  : "Query the live Cube for each playbook's current VIP cohort and open cases"
              }
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                color: 'var(--text-secondary)', background: 'var(--bg-card)',
                border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)',
                padding: '6px 12px', cursor: sweeping || reconnectedSweep ? 'wait' : 'pointer',
                opacity: sweeping || reconnectedSweep ? 0.6 : 1,
              }}
            >
              <RefreshCw size={13} style={{ opacity: sweeping || reconnectedSweep ? 0.5 : 1 }} />
              {sweeping || reconnectedSweep ? 'Sweeping…' : 'Run sweep'}
            </button>
          )}

          {/* Reset demo data — editor/admin only; destructive, so confirm dialog mandatory */}
          {canWrite && (
            <button
              type="button"
              onClick={handleOpenResetDialog}
              disabled={resetting || sweeping || reconnectedSweep}
              title="Wipe all cases for this game to restart the demo (confirm required)"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                color: 'var(--destructive-ink)', background: 'var(--destructive-soft)',
                border: '1px solid var(--destructive-ink)', borderRadius: 'var(--radius-md)',
                padding: '6px 12px', cursor: resetting ? 'wait' : 'pointer',
                opacity: resetting || sweeping || reconnectedSweep ? 0.5 : 1,
              }}
            >
              <Trash2 size={13} />
              {resetting ? 'Resetting…' : 'Reset'}
            </button>
          )}

          {/* Game badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-muted)', padding: '5px 11px', borderRadius: 'var(--radius-full)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
            {gameId}
          </div>
        </div>
      </div>

      {/* Reconnected-sweep banner: a sweep this mount didn't start is running.
          Surfaces source + live elapsed time, with an expand toggle for the live
          per-playbook breakdown; clears (and the page auto-refreshes) on settle. */}
      {reconnectedSweep && (
        <SweepProgressBanner
          source={sweepStatus.source}
          startedAt={sweepStatus.startedAt}
          elapsedS={sweepElapsedS}
          progress={sweepStatus.progress}
        />
      )}

      {sweepMsg && (
        <div style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
          {sweepMsg}
        </div>
      )}

      {resetMsg && (
        <div
          style={{
            margin: '0 0 12px', fontSize: 12, fontFamily: 'var(--font-sans)',
            color: resetMsg.startsWith('Reset failed') ? 'var(--destructive-ink)' : 'var(--text-muted)',
          }}
        >
          {resetMsg}
        </div>
      )}

      <p style={{ margin: '2px 0 20px', fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
        {lens === 'vip'
          ? 'One row per VIP — deduped across all playbooks, ranked by priority, with contact-fatigue guard.'
          : lens === 'sweeps'
            ? 'Sweep snapshots over time — cohort trend per playbook and a run-to-run diff of which VIPs entered or left each cohort.'
            : 'Stateful cases across the selected playbooks — filter by playbook and status, then open the matched member 360.'}
      </p>

      {/* Lens toggle + table card */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border-card)' }}>
          <LensToggle active={lens} onSwitch={handleLensSwitch} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {lens === 'playbook'
              ? playbookIds.length === 0
                ? 'All playbooks'
                : `${playbookIds.length} playbook${playbookIds.length > 1 ? 's' : ''} selected`
              : 'Same ledger · multiple lenses'}
          </span>
        </div>

        {/* Content */}
        {!gameId ? (
          <EmptyState label="Select a game to view cases." />
        ) : lens === 'playbook' ? (
          <ByPlaybookView
            gameId={gameId}
            playbookIds={playbookIds}
            onTogglePlaybook={togglePlaybook}
            statuses={statuses}
            onToggleStatus={toggleStatus}
            onClearStatus={clearStatus}
            onRegisterRefetch={registerPortfolioRefetch}
            onTotalChange={handleTotalChange}
          />
        ) : lens === 'vip' ? (
          <ByVipView
            gameId={gameId}
            onRegisterRefetch={registerQueueRefetch}
            onTotalChange={handleTotalChange}
          />
        ) : (
          <div style={{ padding: 16 }}>
            <SweepsLens gameId={gameId} />
          </div>
        )}
      </div>

      {/* Dedup + fatigue explainer — only meaningful on the action-queue lens. */}
      {lens === 'vip' && (
        <div
          style={{
            display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 16,
            background: 'var(--brand-soft)', border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)', padding: '10px 14px',
            fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)',
          }}
        >
          <Heart size={16} style={{ color: 'var(--brand)', flexShrink: 0, marginTop: 1 }} aria-hidden />
          <div>
            <b style={{ color: 'var(--text-primary)' }}>Deduped action queue:</b> a VIP matching several
            playbooks appears once, ranked by top priority. A VIP contacted within the last 24h is
            <b style={{ color: 'var(--text-primary)' }}> capped</b> by the contact-fatigue guard — the next
            outreach is deferred. Click any row → full Member-360 Care history across every playbook.
          </div>
        </div>
      )}

      {/* Confirm dialog — rendered outside the card so it escapes overflow:hidden */}
      {resetDialogOpen && (
        <ResetConfirmDialog
          gameId={gameId}
          caseCount={resetCaseCount}
          onConfirm={handleResetConfirm}
          onCancel={() => setResetDialogOpen(false)}
        />
      )}
    </div>
  );
}
