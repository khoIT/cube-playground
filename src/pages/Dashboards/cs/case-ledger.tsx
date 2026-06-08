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

import React, { useState, useCallback } from 'react';
import { useLocation, useHistory, Link } from 'react-router-dom';
import { ListChecks, Users, ChevronLeft, RefreshCw } from 'lucide-react';
import { useGameContext } from '../../../components/Header/use-game-context';
import { useAuthUser } from '../../../auth/auth-context';
import { useCareCases, useVipQueue, runCareSweep } from './use-care-cases';
import type { CareCase, VipCaseRow } from './use-care-cases';

// ── Shared helpers ────────────────────────────────────────────────────────────

function parseSnapshot(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.floor(ms / 60_000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Status pill ───────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  new:        { background: 'var(--info-soft)',        color: 'var(--info-ink)' },
  in_review:  { background: 'var(--warning-soft)',     color: 'var(--warning-ink)' },
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
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        whiteSpace: 'nowrap',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ── Snapshot cell ─────────────────────────────────────────────────────────────

function SnapshotCell({ raw }: { raw: string | null }) {
  const snap = parseSnapshot(raw);
  if (!snap) {
    return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>;
  }
  const entries = Object.entries(snap).slice(0, 3);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {entries.map(([k, v]) => (
        <span
          key={k}
          style={{
            fontSize: 10.5,
            background: 'var(--bg-muted)',
            color: 'var(--text-secondary)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 6px',
            fontFamily: 'var(--font-sans)',
          }}
          title={`${k}: ${String(v)}`}
        >
          {k.split('.').pop()}: <strong>{String(v)}</strong>
        </span>
      ))}
    </div>
  );
}

// ── Priority badge ────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: number | string }) {
  const p = String(priority);
  let style: React.CSSProperties = { background: 'var(--muted-soft)', color: 'var(--muted-ink)' };
  let label = p;
  if (p === 'cao' || Number(p) <= 2) {
    style = { background: 'var(--destructive-soft)', color: 'var(--destructive-ink)' };
    label = 'Cao';
  } else if (p === 'tb' || Number(p) <= 4) {
    style = { background: 'var(--info-soft)', color: 'var(--info-ink)' };
    label = 'TB';
  } else {
    label = 'Thấp';
  }
  return (
    <span
      style={{
        ...style,
        fontSize: 10.5,
        fontWeight: 600,
        padding: '2px 7px',
        borderRadius: 'var(--radius-full)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {label}
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

// ── Shared table styles ───────────────────────────────────────────────────────

const cellBase: React.CSSProperties = {
  padding: '10px 14px',
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
  padding: '8px 14px',
  borderBottom: '1px solid var(--border-card)',
  background: 'var(--bg-card)',
  fontFamily: 'var(--font-sans)',
};

// ── By-Playbook table ─────────────────────────────────────────────────────────

interface PlaybookRowProps {
  c: CareCase;
  gameId: string;
  /** segment id used to build the Member-360 link; absent when navigating from queue */
  segId?: string;
}

function PlaybookCaseRow({ c, gameId, segId }: PlaybookRowProps) {
  // Member-360 links to the segment-member view when a segment id is known;
  // otherwise we navigate to the standalone care queue UID view via query param.
  const member360Href = segId
    ? `#/segments/${segId}/members/${encodeURIComponent(c.uid)}`
    : `#/dashboards/cs/queue?game=${encodeURIComponent(gameId)}&uid=${encodeURIComponent(c.uid)}`;

  const isOpen = c.status === 'new' || c.status === 'in_review';

  return (
    <tr
      style={{ cursor: 'pointer', transition: 'background 0.12s' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--brand-soft)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = ''; }}
    >
      <td style={cellBase}>
        <a
          href={member360Href}
          style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none', fontSize: 12 }}
        >
          {c.uid}
        </a>
        {c.condition_lapsed === 1 && <LapsedBadge />}
      </td>
      <td style={cellBase}><StatusPill status={c.status} /></td>
      <td style={cellBase}>
        <SnapshotCell raw={c.stats_snapshot_json} />
      </td>
      <td style={{ ...cellBase, color: 'var(--text-muted)', fontSize: 11.5 }}>
        {relativeTime(c.opened_at ?? c.created_at ?? null)}
      </td>
      <td style={{ ...cellBase, color: 'var(--text-muted)', fontSize: 11.5 }}>
        {isOpen ? '—' : relativeTime(c.treated_at)}
      </td>
      <td style={cellBase}>
        {c.channel_used ? (
          <span style={{ fontSize: 11, background: 'var(--bg-muted)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-full)', padding: '2px 7px' }}>
            {c.channel_used.replace('_', ' ')}
          </span>
        ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </td>
    </tr>
  );
}

interface ByPlaybookViewProps {
  gameId: string;
  playbookId: string;
}

function ByPlaybookView({ gameId, playbookId }: ByPlaybookViewProps) {
  const { status, cases, error } = useCareCases(gameId, { playbookId });

  if (status === 'error') {
    return (
      <div style={{ padding: 16, background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', borderRadius: 'var(--radius-md)', fontSize: 13 }}>
        Failed to load cases: {error}
      </div>
    );
  }

  if (status === 'idle' || status === 'loading') {
    return <LoadingRows />;
  }

  if (cases.length === 0) {
    return <EmptyState label={`No cases for playbook ${playbookId}.`} />;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>UID</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Stats at match</th>
            <th style={thStyle}>Opened</th>
            <th style={thStyle}>Treated</th>
            <th style={thStyle}>Channel</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <PlaybookCaseRow key={c.id} c={c} gameId={gameId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── By-VIP table (action queue) ───────────────────────────────────────────────

interface VipRowProps {
  row: VipCaseRow;
  gameId: string;
}

function VipQueueRow({ row, gameId }: VipRowProps) {
  const openCount = row.cases.filter((c) => c.status === 'new' || c.status === 'in_review').length;

  return (
    <tr
      style={{ cursor: 'pointer', transition: 'background 0.12s' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--brand-soft)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = ''; }}
    >
      {/* UID → action queue UID detail view */}
      <td style={cellBase}>
        <a
          href={`#/dashboards/cs/queue?game=${encodeURIComponent(gameId)}&uid=${encodeURIComponent(row.uid)}`}
          style={{ color: 'var(--brand)', fontWeight: 600, textDecoration: 'none', fontSize: 12 }}
        >
          {row.uid}
        </a>
      </td>

      {/* Top priority */}
      <td style={cellBase}>
        <PriorityBadge priority={row.topPriority} />
      </td>

      {/* Case chips: one per playbook */}
      <td style={cellBase}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {row.playbooks.map((pb) => {
            const pbCases = row.cases.filter((c) => c.playbook_id === pb.id);
            const openPbCases = pbCases.filter((c) => c.status === 'new' || c.status === 'in_review');
            return (
              <span
                key={pb.id}
                title={`${pb.name}: ${pbCases.length} case(s), ${openPbCases.length} open`}
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  background: openPbCases.length > 0 ? 'var(--info-soft)' : 'var(--muted-soft)',
                  color: openPbCases.length > 0 ? 'var(--info-ink)' : 'var(--muted-ink)',
                  fontFamily: 'var(--font-sans)',
                  cursor: 'default',
                }}
              >
                {pb.name} ·{pbCases.length}
              </span>
            );
          })}
        </div>
      </td>

      {/* Open count */}
      <td style={{ ...cellBase, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontWeight: openCount > 0 ? 700 : 400, color: openCount > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {openCount}
        </span>
      </td>

      {/* Last contact (Phase 5 fatigue placeholder) */}
      <td style={{ ...cellBase, color: 'var(--text-muted)', fontSize: 11.5 }}>
        {relativeTime(row.lastTreatedAt)}
      </td>
    </tr>
  );
}

interface ByVipViewProps {
  gameId: string;
}

function ByVipView({ gameId }: ByVipViewProps) {
  const { status, vips, error } = useVipQueue(gameId);

  if (status === 'error') {
    return (
      <div style={{ padding: 16, background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', borderRadius: 'var(--radius-md)', fontSize: 13 }}>
        Failed to load VIP queue: {error}
      </div>
    );
  }

  if (status === 'idle' || status === 'loading') {
    return <LoadingRows />;
  }

  if (vips.length === 0) {
    return <EmptyState label="No open VIP cases." />;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>VIP UID</th>
            <th style={thStyle}>Top priority</th>
            <th style={thStyle}>Playbook cases</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Open</th>
            <th style={thStyle}>Last contact</th>
          </tr>
        </thead>
        <tbody>
          {vips.map((row) => (
            <VipQueueRow key={row.uid} row={row} gameId={gameId} />
          ))}
        </tbody>
      </table>
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

type Lens = 'playbook' | 'vip';

interface LensToggleProps {
  active: Lens;
  onSwitch: (l: Lens) => void;
}

function LensToggle({ active, onSwitch }: LensToggleProps) {
  const btn = (lens: Lens, label: string) => (
    <button
      key={lens}
      type="button"
      onClick={() => onSwitch(lens)}
      style={{
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-md)',
        padding: '5px 14px',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        background: active === lens ? 'var(--brand)' : 'var(--bg-muted)',
        color: active === lens ? '#fff' : 'var(--text-secondary)',
        fontFamily: 'var(--font-sans)',
        transition: 'background 0.12s',
      }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {btn('playbook', 'By Playbook')}
      {btn('vip', 'By VIP')}
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
 *   ?uid=<uid>       → future: drill into VIP detail inline.
 */
export function CaseLedgerPage() {
  const location = useLocation();
  const history = useHistory();
  const { gameId: ctxGame } = useGameContext();

  const user = useAuthUser();
  const canWrite = user?.role === 'editor' || user?.role === 'admin';

  const params = new URLSearchParams(location.search);
  const playbookParam = params.get('playbook') ?? '';
  const gameParam = params.get('game') ?? '';
  const gameId = gameParam || ctxGame;

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

  // Determine initial lens from URL.
  const initialLens: Lens = playbookParam ? 'playbook' : 'vip';
  const [lens, setLens] = useState<Lens>(initialLens);

  const handleLensSwitch = useCallback(
    (l: Lens) => {
      setLens(l);
      // Preserve game param but drop playbook when switching to vip lens.
      const next = new URLSearchParams(location.search);
      if (l === 'vip') next.delete('playbook');
      history.replace({ ...location, search: next.toString() });
    },
    [history, location],
  );

  return (
    <div style={pageStyle}>
      {/* Eyebrow */}
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 5 }}>
        Dashboards
      </div>

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
            ? <Users size={22} color="var(--brand)" />
            : <ListChecks size={22} color="var(--brand)" />}
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
            {lens === 'vip' ? 'VIP Action Queue' : `Case Ledger${playbookParam ? ` · ${playbookParam}` : ''}`}
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Run sweep — editor/admin only; populates the ledger from the live Cube. */}
          {canWrite && (
            <button
              type="button"
              onClick={handleSweep}
              disabled={sweeping}
              title="Query the live Cube for each playbook's current VIP cohort and open cases"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                color: 'var(--text-secondary)', background: 'var(--bg-card)',
                border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)',
                padding: '6px 12px', cursor: sweeping ? 'wait' : 'pointer',
                opacity: sweeping ? 0.6 : 1,
              }}
            >
              <RefreshCw size={13} style={{ opacity: sweeping ? 0.5 : 1 }} />
              {sweeping ? 'Sweeping…' : 'Run sweep'}
            </button>
          )}

          {/* Game badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', background: 'var(--bg-muted)', padding: '5px 11px', borderRadius: 'var(--radius-full)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
            {gameId}
          </div>
        </div>
      </div>

      {sweepMsg && (
        <div style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
          {sweepMsg}
        </div>
      )}

      <p style={{ margin: '2px 0 18px', fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
        {lens === 'vip'
          ? 'One row per VIP, deduplicated across all playbooks, ranked by top priority.'
          : 'Cases matched by this playbook with stats snapshot at match time.'}
      </p>

      {/* Lens toggle + table card */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border-card)', background: 'var(--bg-muted)' }}>
          <LensToggle active={lens} onSwitch={handleLensSwitch} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {lens === 'playbook' && playbookParam && `Playbook: ${playbookParam}`}
          </span>
        </div>

        {/* Content */}
        {!gameId ? (
          <EmptyState label="Select a game to view cases." />
        ) : lens === 'playbook' ? (
          <ByPlaybookView gameId={gameId} playbookId={playbookParam} />
        ) : (
          <ByVipView gameId={gameId} />
        )}
      </div>
    </div>
  );
}
