/**
 * PlaybookGrid — 21-playbook table grouped into 4 collapsible NHÓM sections.
 *
 * Row rendering by availability:
 *   available  → clickable, live numbers, priority + data badge, status dot.
 *   partial    → clickable, partial badge, dashed metrics.
 *   unavailable → GREYED row, config visible, dashed metrics, NO cohort query.
 *
 * CRITICAL invariant: unavailable rows fire ZERO additional network requests.
 * All data shown for unavailable rows comes from the registry (already fetched
 * by use-care-playbooks). The grid itself never issues a query for those rows.
 *
 * Priority badge colors follow the flow prototype:
 *   cao  → destructive-soft / destructive-ink
 *   tb   → info-soft / info-ink
 *   thap → muted-soft / muted-ink
 *
 * Data/availability badge:
 *   available   → success-soft / success-ink
 *   partial     → warning-soft / warning-ink
 *   unavailable → muted-soft / muted-ink
 */

import React, { useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import { updatePlaybook, createPlaybook } from './use-playbook-mutations';
import { mutationTargetFor } from './playbook-mutation-target';
import { primaryCubeOf, formatAsOf } from './data-freshness-format';
import type { ResolvedPlaybook, PlaybookCaseAgg } from './use-care-playbooks';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlaybookGridProps {
  playbooks: ResolvedPlaybook[];
  casesByPlaybook: Map<string, PlaybookCaseAgg>;
  gameId: string;
  /** Editor/admin can see Edit / Clone / Disable actions; viewers see none. */
  canWrite?: boolean;
  /** logical cube → 'YYYY-MM-DD' the cube's data is current to (best-effort, may be empty). */
  asOfByCube?: Record<string, string>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NHOM_LABELS: Record<number, { label: string; description: string }> = {
  1: { label: 'NHÓM 1 · Payment', description: 'Payment behavior' },
  2: { label: 'NHÓM 2 · In-game', description: 'In-game behavior' },
  3: { label: 'NHÓM 3 · Churn', description: 'Churn risk' },
  4: { label: 'NHÓM 4 · Time & Event', description: 'Time-based & event triggers' },
};

// ── Badge helpers ─────────────────────────────────────────────────────────────

type BadgeVariant = 'cao' | 'tb' | 'thap' | 'available' | 'partial' | 'unavailable';

const BADGE_STYLES: Record<BadgeVariant, React.CSSProperties> = {
  cao:         { background: 'var(--destructive-soft)', color: 'var(--destructive-ink)' },
  tb:          { background: 'var(--info-soft)',        color: 'var(--info-ink)' },
  thap:        { background: 'var(--muted-soft)',       color: 'var(--muted-ink)' },
  available:   { background: 'var(--success-soft)',     color: 'var(--success-ink)' },
  partial:     { background: 'var(--warning-soft)',     color: 'var(--warning-ink)' },
  unavailable: { background: 'var(--muted-soft)',       color: 'var(--muted-ink)' },
};

const BADGE_LABELS: Partial<Record<BadgeVariant, string>> = {
  cao:         'High',
  tb:          'Medium',
  thap:        'Low',
  available:   'Live',
  partial:     'Partial',
  unavailable: 'Blocked',
};

function Badge({ variant, label }: { variant: BadgeVariant; label?: string }) {
  return (
    <span
      style={{
        ...BADGE_STYLES[variant],
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 10.5,
        fontWeight: 600,
        padding: '3px 8px',
        borderRadius: 'var(--radius-full)',
        whiteSpace: 'nowrap',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {label ?? BADGE_LABELS[variant]}
    </span>
  );
}

// Status dot
function StatusDot({ availability }: { availability: ResolvedPlaybook['availability'] }) {
  const color =
    availability === 'available'
      ? 'var(--success)'
      : availability === 'partial'
      ? 'var(--warning)'
      : 'var(--border-strong)';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

// ── Group header ──────────────────────────────────────────────────────────────

interface GroupHeaderProps {
  nhom: number;
  rows: ResolvedPlaybook[];
  expanded: boolean;
  onToggle: () => void;
}

function GroupHeader({ nhom, rows, expanded, onToggle }: GroupHeaderProps) {
  const live = rows.filter((r) => r.availability !== 'unavailable').length;
  const blocked = rows.filter((r) => r.availability === 'unavailable').length;
  const info = NHOM_LABELS[nhom];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => e.key === 'Enter' && onToggle()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 16px',
        background: 'var(--bg-muted)',
        borderBottom: '1px solid var(--border-card)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
        {expanded
          ? <ChevronDown size={14} />
          : <ChevronRight size={14} />}
      </span>
      <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-sans)' }}>
        {info?.label ?? `NHÓM ${nhom}`}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
        {info?.description}
      </span>
      <span
        style={{
          marginLeft: 'auto',
          fontSize: 11,
          color: 'var(--text-muted)',
          display: 'flex',
          gap: 12,
          fontFamily: 'var(--font-sans)',
        }}
      >
        <span>{live} live</span>
        {blocked > 0 && <span>{blocked} blocked</span>}
        <span>{rows.length} total</span>
      </span>
    </div>
  );
}

// ── Playbook row ──────────────────────────────────────────────────────────────

// ── Kebab menu ────────────────────────────────────────────────────────────────

interface RowKebabProps {
  playbook: ResolvedPlaybook;
  gameId: string;
}

function RowKebab({ playbook, gameId }: RowKebabProps) {
  const history = useHistory();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(false);
    if (playbook.source !== 'seed') {
      // Existing DB row (override OR custom) → edit it directly; save will PATCH.
      history.push(`/dashboards/cs/playbooks/${encodeURIComponent(playbook.id)}/edit`);
    } else {
      // Edit a seed → builder pre-fills from registry; save will POST with base_id.
      history.push(
        `/dashboards/cs/playbooks/${encodeURIComponent(playbook.id)}/edit?base_id=${encodeURIComponent(playbook.id)}`,
      );
    }
  }

  function handleClone(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(false);
    // Clone = new playbook pre-filled from this one, base_id=null.
    history.push(
      `/dashboards/cs/playbooks/new?base_id=${encodeURIComponent(playbook.id)}&clone=1`,
    );
  }

  // Flip `enabled` on/off. A seed has no DB row, so disabling one creates an
  // override (enabled=false); every other case PATCHes the existing row by its
  // overrideId (NOT the display id — see mutationTargetFor).
  async function setEnabled(next: boolean, e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(false);
    setBusy(true);
    try {
      const target = mutationTargetFor(playbook);
      if (target.kind === 'patch') {
        await updatePlaybook(target.overrideId, { enabled: next });
      } else {
        // Seed (or defensive net-new): create an override carrying the new state.
        await createPlaybook(gameId, {
          base_id: target.kind === 'createFromSeed' ? target.baseId : null,
          name: playbook.name,
          group: playbook.group,
          priority: playbook.priority,
          condition: playbook.condition as Parameters<typeof createPlaybook>[1]['condition'],
          watchedMetric: playbook.watchedMetric,
          action: playbook.action,
          dataRequirements: playbook.dataRequirements,
          enabled: next,
        });
      }
      // Reload the page to reflect the change.
      window.location.reload();
    } catch {
      // Re-enable the button; user can retry.
      setBusy(false);
    }
  }

  const menuItems: { label: string; onClick: (e: React.MouseEvent) => void; destructive?: boolean }[] = [
    { label: 'Edit', onClick: handleEdit },
    { label: 'Clone as new', onClick: handleClone },
    {
      label: playbook.enabled ? 'Disable' : 'Enable',
      onClick: (e: React.MouseEvent) => setEnabled(!playbook.enabled, e),
      destructive: playbook.enabled,
    },
  ];

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); setOpen((p) => !p); }}
        style={{
          background: 'none',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-md)',
          cursor: busy ? 'not-allowed' : 'pointer',
          padding: '3px 6px',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          lineHeight: 1,
        }}
        title="Playbook actions"
        aria-label="Playbook actions"
      >
        <MoreHorizontal size={13} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '110%',
            zIndex: 50,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md, 0 4px 12px rgba(0,0,0,.12))',
            minWidth: 150,
            overflow: 'hidden',
          }}
        >
          {menuItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 14px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 12.5,
                fontFamily: 'var(--font-sans)',
                color: item.destructive ? 'var(--destructive-ink)' : 'var(--text-primary)',
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-muted)')
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLButtonElement).style.background = 'none')
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Playbook row ──────────────────────────────────────────────────────────────

interface PlaybookRowProps {
  playbook: ResolvedPlaybook;
  agg: PlaybookCaseAgg | undefined;
  gameId: string;
  canWrite?: boolean;
  /** as-of date for this row's backing cube (best-effort), or undefined when unknown. */
  asOf?: string;
}

function PlaybookRow({ playbook, agg, gameId, canWrite, asOf }: PlaybookRowProps) {
  const isUnavailable = playbook.availability === 'unavailable';
  // CRITICAL: unavailable rows are visually greyed; they receive no click
  // navigation and (because we never reach into agg for unavailable rows) they
  // issue no further fetch. The agg map only contains playbooks that have cases
  // from /api/care/cases, which is fetched once regardless of availability.
  // No per-row Cube/cohort query is ever initiated in this component.

  const openCases = isUnavailable ? null : (agg?.open ?? 0);
  const slaBreached = isUnavailable ? null : (agg?.slaBreached ?? 0);

  // Queue link — /dashboards/cs/queue scoped to this game + playbook.
  const queueHref = !isUnavailable
    ? `#/dashboards/cs/queue?game=${encodeURIComponent(gameId)}&playbook=${encodeURIComponent(playbook.id)}`
    : undefined;

  const cellBase: React.CSSProperties = {
    padding: '10px 16px',
    borderBottom: '1px solid var(--border-card)',
    fontSize: 12.5,
    verticalAlign: 'middle',
    fontFamily: 'var(--font-sans)',
  };

  const mutedText: React.CSSProperties = isUnavailable
    ? { color: 'var(--text-muted)', opacity: 0.7 }
    : {};

  const dashedValue = (
    <span
      style={{
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--text-muted)',
        letterSpacing: '0.05em',
      }}
    >
      – –
    </span>
  );

  return (
    <tr
      style={{
        opacity: isUnavailable ? 0.55 : 1,
        cursor: isUnavailable ? 'not-allowed' : 'pointer',
        transition: 'background 0.12s',
      }}
      onClick={() => {
        if (!isUnavailable && queueHref) {
          window.location.href = queueHref;
        }
      }}
      onMouseEnter={(e) => {
        if (!isUnavailable) {
          (e.currentTarget as HTMLTableRowElement).style.background = 'var(--brand-soft)';
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLTableRowElement).style.background = '';
      }}
    >
      {/* ID + name */}
      <td style={cellBase}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot availability={playbook.availability} />
          <span>
            <span
              style={{
                color: 'var(--text-muted)',
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
                marginRight: 8,
                ...mutedText,
              }}
            >
              #{playbook.id}
            </span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', ...mutedText }}>
              {playbook.name}
            </span>
          </span>
        </div>
      </td>

      {/* Priority */}
      <td style={cellBase}>
        {isUnavailable ? (
          <Badge variant="unavailable" />
        ) : (
          <Badge variant={playbook.priority} />
        )}
      </td>

      {/* Availability / data badge + as-of date of the backing cube */}
      <td style={cellBase}>
        <Badge variant={playbook.availability} />
        {!isUnavailable && asOf && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              marginTop: 4,
              fontVariantNumeric: 'tabular-nums',
            }}
            title="The freshest date this playbook's data source holds — its cohort is a snapshot as of this day, not necessarily today."
          >
            as of {formatAsOf(asOf)}
          </div>
        )}
      </td>

      {/* Watched metric + KPI */}
      <td style={{ ...cellBase, ...mutedText, fontSize: 11.5, color: 'var(--text-secondary)' }}>
        {isUnavailable ? (
          <>
            <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>
              {playbook.watchedMetric.label}
            </span>
            {playbook.watchedMetric.kpiTarget && (
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                target: {playbook.watchedMetric.kpiTarget}
              </div>
            )}
          </>
        ) : (
          <>
            <strong style={{ color: 'var(--text-primary)' }}>
              {playbook.watchedMetric.label}
            </strong>
            {playbook.watchedMetric.kpiTarget && (
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                target: {playbook.watchedMetric.kpiTarget}
              </div>
            )}
          </>
        )}
      </td>

      {/* Open cases */}
      <td style={{ ...cellBase, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {openCases === null ? dashedValue : (
          <span style={{ fontWeight: openCases > 0 ? 600 : 400, color: openCases > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {openCases}
          </span>
        )}
      </td>

      {/* SLA breaches */}
      <td style={{ ...cellBase, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {slaBreached === null ? dashedValue : (
          <span
            style={{
              fontWeight: slaBreached > 0 ? 600 : 400,
              color: slaBreached > 0 ? 'var(--destructive-ink)' : 'var(--text-muted)',
            }}
          >
            {slaBreached}
          </span>
        )}
      </td>

      {/* SLA label */}
      <td style={{ ...cellBase, textAlign: 'right', color: 'var(--text-muted)', fontSize: 11, ...mutedText }}>
        {isUnavailable ? (
          dashedValue
        ) : playbook.action.slaMinutes ? (
          <span>{playbook.action.slaMinutes < 60
            ? `${playbook.action.slaMinutes}m`
            : `${Math.round(playbook.action.slaMinutes / 60)}h`}</span>
        ) : (
          <span>24h</span>
        )}
      </td>

      {/* Kebab actions — only shown for editor/admin */}
      <td
        style={{ ...cellBase, textAlign: 'right', width: 40 }}
        onClick={(e) => e.stopPropagation()}
      >
        {canWrite && <RowKebab playbook={playbook} gameId={gameId} />}
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PlaybookGrid({ playbooks, casesByPlaybook, gameId, canWrite, asOfByCube }: PlaybookGridProps) {
  // Group playbooks by nhom (1-4), preserving registry order within each group.
  const groups = React.useMemo(() => {
    const map = new Map<number, ResolvedPlaybook[]>();
    for (const p of playbooks) {
      if (!map.has(p.nhom)) map.set(p.nhom, []);
      map.get(p.nhom)!.push(p);
    }
    // Return sorted by nhom key.
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [playbooks]);

  // All groups start expanded.
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([1, 2, 3, 4]));

  function toggleGroup(nhom: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nhom)) next.delete(nhom);
      else next.add(nhom);
      return next;
    });
  }

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {groups.map(([nhom, rows]) => (
        <div
          key={nhom}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-sm)',
            overflow: 'hidden',
          }}
        >
          <GroupHeader
            nhom={nhom}
            rows={rows}
            expanded={expanded.has(nhom)}
            onToggle={() => toggleGroup(nhom)}
          />

          {expanded.has(nhom) && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Playbook</th>
                    <th style={thStyle}>Priority</th>
                    <th style={thStyle}>Data</th>
                    <th style={thStyle}>Watched metric</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Open</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>SLA breach</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>SLA</th>
                    {canWrite && <th style={{ ...thStyle, width: 40 }} />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <PlaybookRow
                      key={p.id}
                      playbook={p}
                      agg={
                        // CRITICAL: pass undefined for unavailable rows so the
                        // component never renders live case numbers for them.
                        // This is the last line of defence against accidental
                        // data display; the hook already fires no per-row query.
                        p.availability === 'unavailable'
                          ? undefined
                          : casesByPlaybook.get(p.id)
                      }
                      gameId={gameId}
                      canWrite={canWrite}
                      asOf={
                        p.availability === 'unavailable'
                          ? undefined
                          : asOfByCube?.[primaryCubeOf(p.dataRequirements) ?? '']
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
