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
import { ListChecks, Users, ChevronLeft, RefreshCw, Heart } from 'lucide-react';
import { useGameContext } from '../../../components/Header/use-game-context';
import { useAuthUser } from '../../../auth/auth-context';
import { formatValue, formatValueExact } from '../../Segments/detail/cards/format-value';
import { useCareCases, useVipQueue, runCareSweep } from './use-care-cases';
import { summarizeSnapshot } from './case-snapshot-summary';
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

// ── "Why it fired" — human summary of the snapshot / threshold rule ─────────────

/** "Why it fired" cell — prefers the threshold-rule summary, falls back to scalars. */
function WhyFiredCell({ raw }: { raw: string | null }) {
  const text = summarizeSnapshot(raw);
  if (!text) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>;
  return (
    <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
      Matched: <b style={{ color: 'var(--text-primary)' }}>{text}</b>
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

/** "₫10.18M" with the exact figure in a tooltip; em-dash when unknown. */
function ltvLabel(vnd: number | null): string {
  return vnd == null ? '—' : formatValue(vnd, 'currency');
}

// Recent treatment within this window flips a VIP to a contact-fatigue "cap":
// the next outreach is deferred so the same whale isn't pinged twice in a day.
const FATIGUE_WINDOW_MS = 24 * 3_600_000;

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
  const profile = c.profile;
  const history = useHistory();
  // Member-360 links to the segment-member view when a segment id is known;
  // otherwise the standalone care route carries the game on the URL.
  const path = segId
    ? `/segments/${segId}/members/${encodeURIComponent(c.uid)}`
    : `/dashboards/cs/members/${encodeURIComponent(c.uid)}?game=${encodeURIComponent(gameId)}`;

  return (
    <tr
      onClick={() => history.push(path)}
      style={{ cursor: 'pointer', transition: 'background 0.12s' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--brand-soft)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = ''; }}
    >
      {/* VIP */}
      <td style={{ ...cellBase, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {profile?.name ?? c.uid}
        {c.condition_lapsed === 1 && <LapsedBadge />}
      </td>
      {/* Why it fired (snapshot at match time) */}
      <td style={cellBase}><WhyFiredCell raw={c.stats_snapshot_json} /></td>
      {/* LTV */}
      <td style={{ ...cellBase, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {profile?.ltvVnd != null
          ? <span title={formatValueExact(profile.ltvVnd, 'currency') ?? undefined}>{ltvLabel(profile.ltvVnd)}</span>
          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
      </td>
      {/* State */}
      <td style={cellBase}><StatusPill status={c.status} /></td>
      {/* Opened */}
      <td style={{ ...cellBase, color: 'var(--text-muted)', fontSize: 11.5 }}>
        {relativeTime(c.opened_at ?? c.created_at ?? null)}
      </td>
      {/* Action */}
      <td style={{ ...cellBase, textAlign: 'right', width: 130 }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); history.push(path); }}
          style={{
            fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-sans)',
            color: '#fff', background: 'var(--brand)', border: '1px solid var(--brand)',
            borderRadius: 'var(--radius-md)', padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          Open 360 →
        </button>
      </td>
    </tr>
  );
}

interface ByPlaybookViewProps {
  gameId: string;
  playbookId: string;
}

function ByPlaybookView({ gameId, playbookId }: ByPlaybookViewProps) {
  // Cases arrive pre-enriched with the persisted VIP profile (name + LTV) — no
  // live Cube call; the sweep populates it.
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
            <th style={{ ...thStyle, width: '16%' }}>VIP</th>
            <th style={thStyle}>Why it fired (snapshot at match time)</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>LTV</th>
            <th style={thStyle}>State</th>
            <th style={thStyle}>Opened</th>
            <th style={{ ...thStyle, width: 130 }} aria-label="Action" />
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
  const history = useHistory();
  const profile: CareVipProfileDto | null | undefined = row.profile;
  const base = `/dashboards/cs/members/${encodeURIComponent(row.uid)}?game=${encodeURIComponent(gameId)}`;
  const go = (toCare: boolean) => history.push(toCare ? `${base}&tab=care` : base);

  // Identity: name (main character) when known, else the uid. LTV · tier sits
  // under it; churn pay/play idle days form a compact third line when present.
  const title = profile?.name ?? row.uid;
  const idLine = [profile && ltvLabel(profile.ltvVnd), profile?.tier].filter(Boolean).join(' · ');
  const churn =
    profile && (profile.churnPayDays != null || profile.churnPlayDays != null)
      ? `no-pay ${profile.churnPayDays ?? '—'}d · idle ${profile.churnPlayDays ?? '—'}d`
      : null;

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
      <td style={{ ...cellBase, width: '20%' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.uid}>
          {title}
        </div>
        {idLine && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }} title={profile?.ltvVnd != null ? (formatValueExact(profile.ltvVnd, 'currency') ?? undefined) : undefined}>
            {idLine}
          </div>
        )}
        {churn && (
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{churn}</div>
        )}
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

      {/* Action — Take care (→ Care tab) or Deferred when fatigue-capped */}
      <td style={{ ...cellBase, textAlign: 'right', width: 130 }}>
        {fatigued ? (
          <button
            type="button"
            disabled
            title="Contacted recently — outreach deferred by the contact-fatigue guard"
            style={{
              fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-sans)',
              color: 'var(--text-muted)', background: 'var(--bg-card)',
              border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)',
              padding: '5px 12px', opacity: 0.55, cursor: 'not-allowed',
            }}
          >
            Deferred
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); go(true); }}
            style={{
              fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-sans)',
              color: '#fff', background: 'var(--brand)', border: '1px solid var(--brand)',
              borderRadius: 'var(--radius-md)', padding: '5px 12px', cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title="Open the member 360 Care tab to log a treatment"
          >
            Take care →
          </button>
        )}
      </td>
    </tr>
  );
}

interface ByVipViewProps {
  gameId: string;
}

function ByVipView({ gameId }: ByVipViewProps) {
  // Rows arrive pre-enriched with the persisted VIP profile (name / LTV / tier /
  // churn) from the sweep — SQLite read, no live Cube. Un-swept VIPs show dashes.
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
            <th style={{ ...thStyle, width: '20%' }}>VIP</th>
            <th style={thStyle}>Open cases (cross-playbook)</th>
            <th style={thStyle}>Top priority</th>
            <th style={thStyle}>Last contact</th>
            <th style={{ ...thStyle, width: 130 }} aria-label="Action" />
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
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1400,
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
          ? 'One row per VIP — deduped across all playbooks, ranked by priority, with contact-fatigue guard.'
          : 'Stateful cases for a single playbook, with the stats snapshot that fired each one.'}
      </p>

      {/* Lens toggle + table card */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border-card)' }}>
          <LensToggle active={lens} onSwitch={handleLensSwitch} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {lens === 'playbook' && playbookParam ? `Playbook: ${playbookParam}` : 'Same ledger · two lenses'}
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
    </div>
  );
}
