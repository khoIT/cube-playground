/**
 * ApiKeysTab — "API Keys" panel in the sys-admin hub.
 *
 * Manages service keys for the public /api/public/v1 segment-export surface.
 * Admins can issue scoped API keys, monitor their usage, and revoke them.
 *
 * Layout:
 *   1. Page header (eyebrow + icon + title + description)
 *   2. "Create key" button → modal (label, workspace, optional scope + expiry)
 *      → on success: plaintext one-time reveal block with copy affordance
 *   3. Keys table (label, prefix, workspace, scope, status pill, last used,
 *      created by, revoke button — disabled when not active)
 *   4. Collapsible "Recent pulls" audit section (CollapseChevron toggle)
 *
 * Tokens only — no raw hex, no new font stacks. Mirrors preagg-runs-tab and
 * segment-refresh-ops-tab style recipes.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, Copy, Check, AlertTriangle } from 'lucide-react';
import {
  apiKeysClient,
  type ApiKeyListItem,
  type PullAuditItem,
  type CreateApiKeyInput,
} from '../../../api/api-keys-client';
import { CollapseChevron } from './collapse-chevron';

// ---------------------------------------------------------------------------
// Shared style recipes (mirrors sibling tabs)
// ---------------------------------------------------------------------------

const card: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
};

const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
};

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 14px',
  fontSize: 12.5,
  fontWeight: 600,
  fontFamily: 'var(--font-sans)',
  color: 'var(--text-on-brand)',
  background: 'var(--brand)',
  border: '1px solid var(--brand)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 14px',
  fontSize: 12.5,
  fontWeight: 600,
  fontFamily: 'var(--font-sans)',
  color: 'var(--text-secondary)',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 26,
  padding: '0 10px',
  fontSize: 11.5,
  fontWeight: 600,
  fontFamily: 'var(--font-sans)',
  color: 'var(--destructive-ink)',
  background: 'var(--destructive-soft)',
  border: '1px solid var(--destructive-ink)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
};

// Small neutral action (Reveal / Extend) — same footprint as btnDanger.
const btnGhost: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 26,
  padding: '0 10px',
  fontSize: 11.5,
  fontWeight: 600,
  fontFamily: 'var(--font-sans)',
  color: 'var(--brand)',
  background: 'var(--brand-soft)',
  border: '1px solid var(--brand)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 32,
  padding: '0 10px',
  fontSize: 12.5,
  fontFamily: 'var(--font-sans)',
  color: 'var(--text-primary)',
  background: 'var(--bg-input, var(--bg-muted))',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-sm)',
  boxSizing: 'border-box',
};

const th: React.CSSProperties = {
  ...eyebrow,
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-card)',
  whiteSpace: 'nowrap',
  background: 'var(--bg-card)',
};

const td: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--text-secondary)',
  padding: '9px 12px',
  borderBottom: '1px solid var(--border-card)',
  verticalAlign: 'middle',
};

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

function StatusPill({ status }: { status: ApiKeyListItem['status'] }) {
  const styles: Record<ApiKeyListItem['status'], React.CSSProperties> = {
    active: {
      background: 'var(--success-soft)',
      color: 'var(--success-ink)',
      border: '1px solid var(--success-ink)',
    },
    revoked: {
      background: 'var(--destructive-soft)',
      color: 'var(--destructive-ink)',
      border: '1px solid var(--destructive-ink)',
    },
    expired: {
      background: 'var(--warning-soft)',
      color: 'var(--warning-ink)',
      border: '1px solid var(--warning-ink)',
    },
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        padding: '0 8px',
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 'var(--radius-full)',
        ...styles[status],
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Scope summary helper
// ---------------------------------------------------------------------------

function scopeSummary(key: ApiKeyListItem): string {
  const parts: string[] = [];
  if (key.segmentIds && key.segmentIds.length > 0) {
    parts.push(`${key.segmentIds.length} segment${key.segmentIds.length !== 1 ? 's' : ''}`);
  }
  if (key.gameIds && key.gameIds.length > 0) {
    parts.push(`${key.gameIds.length} game${key.gameIds.length !== 1 ? 's' : ''}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'all';
}

// ---------------------------------------------------------------------------
// Date formatting helpers
// ---------------------------------------------------------------------------

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'never';
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diffMs / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// One-time plaintext reveal block
// ---------------------------------------------------------------------------

function PlaintextReveal({ plaintext, onClose }: { plaintext: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(plaintext).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div
      style={{
        marginTop: 16,
        padding: '14px 16px',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--warning-soft)',
        border: '1px solid var(--warning-ink)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <AlertTriangle size={16} style={{ color: 'var(--warning-ink)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning-ink)' }}>
          Treat this key like a password — you can re-reveal it anytime from the table below
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-md)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12.5,
          color: 'var(--text-primary)',
          wordBreak: 'break-all',
        }}
      >
        <span style={{ flex: 1 }}>{plaintext}</span>
        <button
          type="button"
          onClick={handleCopy}
          title="Copy to clipboard"
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            height: 28,
            padding: '0 10px',
            fontSize: 11.5,
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            color: copied ? 'var(--success-ink)' : 'var(--brand)',
            background: copied ? 'var(--success-soft)' : 'var(--brand-soft)',
            border: `1px solid ${copied ? 'var(--success-ink)' : 'var(--brand)'}`,
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onClose} style={btnSecondary}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create key modal
// ---------------------------------------------------------------------------

interface CreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (key: ApiKeyListItem, plaintext: string) => void;
}

function CreateKeyModal({ open, onClose, onCreated }: CreateModalProps) {
  const [label, setLabel] = useState('');
  const [workspace, setWorkspace] = useState('prod');
  const [segmentIdsRaw, setSegmentIdsRaw] = useState('');
  const [gameIdsRaw, setGameIdsRaw] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  // Reset form each time the modal opens.
  useEffect(() => {
    if (open) {
      setLabel('');
      setWorkspace('prod');
      setSegmentIdsRaw('');
      setGameIdsRaw('');
      setExpiresAt('');
      setBusy(false);
      setErr(null);
      // Focus the label field.
      setTimeout(() => labelRef.current?.focus(), 60);
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedLabel = label.trim();
    const trimmedWorkspace = workspace.trim();
    if (!trimmedLabel) { setErr('Label is required.'); return; }
    if (!trimmedWorkspace) { setErr('Workspace is required.'); return; }

    const parseIds = (raw: string): string[] | null => {
      const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
      return ids.length > 0 ? ids : null;
    };

    // <input type="datetime-local"> yields a zone-less 'YYYY-MM-DDTHH:mm'; the
    // server validates a full ISO-8601 datetime (with offset). Convert via Date
    // (interpreted as local time) → toISOString(). Empty = non-expiring.
    const expiresAtIso = (() => {
      const v = expiresAt.trim();
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    })();

    const input: CreateApiKeyInput = {
      label: trimmedLabel,
      workspace: trimmedWorkspace,
      segmentIds: parseIds(segmentIdsRaw),
      gameIds: parseIds(gameIdsRaw),
      expiresAt: expiresAtIso,
    };

    setBusy(true);
    setErr(null);
    try {
      const { key, plaintext } = await apiKeysClient.create(input);
      onCreated(key, plaintext);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  if (!open) return null;

  const fieldLabel: React.CSSProperties = {
    display: 'block',
    fontSize: 11.5,
    fontWeight: 600,
    color: 'var(--text-muted)',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  };

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        style={{ width: 'min(500px, 100%)', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Create API key"
      >
        {/* Modal header */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <KeyRound size={18} style={{ color: 'var(--brand)', flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Create API key</span>
        </div>

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(e)} style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Label */}
          <div>
            <label style={fieldLabel} htmlFor="ak-label">Label *</label>
            <input
              ref={labelRef}
              id="ak-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. data-platform-export-prod"
              required
              disabled={busy}
              style={inputStyle}
            />
          </div>

          {/* Workspace */}
          <div>
            <label style={fieldLabel} htmlFor="ak-workspace">Workspace *</label>
            <input
              id="ak-workspace"
              type="text"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder="prod"
              required
              disabled={busy}
              style={inputStyle}
            />
          </div>

          {/* Segment IDs (optional) */}
          <div>
            <label style={fieldLabel} htmlFor="ak-segments">Segment IDs (optional — comma-separated)</label>
            <input
              id="ak-segments"
              type="text"
              value={segmentIdsRaw}
              onChange={(e) => setSegmentIdsRaw(e.target.value)}
              placeholder="Leave empty for all segments"
              disabled={busy}
              style={inputStyle}
            />
          </div>

          {/* Game IDs (optional) */}
          <div>
            <label style={fieldLabel} htmlFor="ak-games">Game IDs (optional — comma-separated)</label>
            <input
              id="ak-games"
              type="text"
              value={gameIdsRaw}
              onChange={(e) => setGameIdsRaw(e.target.value)}
              placeholder="Leave empty for all games"
              disabled={busy}
              style={inputStyle}
            />
          </div>

          {/* Expiry */}
          <div>
            <label style={fieldLabel} htmlFor="ak-expiry">Expires at (optional — ISO 8601)</label>
            <input
              id="ak-expiry"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={busy}
              style={{ ...inputStyle, height: 34 }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Leave empty for a non-expiring key.
            </div>
          </div>

          {err && (
            <div style={{ fontSize: 12, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', borderRadius: 'var(--radius-sm)', padding: '7px 10px' }}>
              {err}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
            <button type="button" onClick={onClose} disabled={busy} style={{ ...btnSecondary, opacity: busy ? 0.55 : 1 }}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              style={{ ...btnPrimary, opacity: busy ? 0.55 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}
            >
              {busy ? 'Creating…' : 'Create key'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Audit section
// ---------------------------------------------------------------------------

function AuditSection({ keyId }: { keyId?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PullAuditItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setErr(null);
    apiKeysClient.audit(200)
      .then((r) => {
        const filtered = keyId ? r.audit.filter((a) => a.keyId === keyId) : r.audit;
        setRows(filtered);
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [open, keyId]);

  return (
    <section style={{ ...card, marginTop: 18, overflow: 'hidden' }}>
      {/* Collapsible header */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: open ? '1px solid var(--border-card)' : 'none', cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      >
        <CollapseChevron open={open} onToggle={() => setOpen((o) => !o)} label="Toggle recent pulls" />
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Recent pulls</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          last 200 pull-audit records{keyId ? ' for this key' : ' across all keys'}
        </span>
      </div>

      {open && (
        <>
          {loading && (
            <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
          )}
          {err && (
            <div style={{ padding: '10px 14px', fontSize: 12.5, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)' }}>
              Could not load audit: {err}
            </div>
          )}
          {!loading && !err && rows.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
              No pull records yet.
            </div>
          )}
          {!loading && !err && rows.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={th}>Key prefix</th>
                    <th style={th}>Segment</th>
                    <th style={th}>Started</th>
                    <th style={{ ...th, textAlign: 'right' }}>Rows</th>
                    <th style={th}>Format</th>
                    <th style={th}>Source</th>
                    <th style={th}>Status</th>
                    <th style={th}>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{row.keyId.slice(0, 8)}…</td>
                      <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{row.segmentId}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtRelative(row.startedAt)}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {row.rowsStreamed.toLocaleString()}
                      </td>
                      <td style={td}>{row.format ?? '—'}</td>
                      <td style={td}>{row.source ?? '—'}</td>
                      <td style={td}>
                        <AuditStatusBadge status={row.status} />
                      </td>
                      <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.clientIp ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AuditStatusBadge({ status }: { status: string }) {
  // Backend writes 'complete' | 'aborted' | 'error' | 'streaming' (see
  // public-pull-audit.ts); 'streaming' is an in-flight (neutral) row.
  const isOk = status === 'complete' || status === 'ok' || status === 'done';
  const isErr = status === 'error' || status === 'aborted' || status === 'failed';
  const bg = isOk ? 'var(--success-soft)' : isErr ? 'var(--destructive-soft)' : 'var(--muted-soft)';
  const color = isOk ? 'var(--success-ink)' : isErr ? 'var(--destructive-ink)' : 'var(--muted-ink)';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 7px',
        fontSize: 10.5,
        fontWeight: 700,
        borderRadius: 'var(--radius-full)',
        background: bg,
        color,
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Keys table
// ---------------------------------------------------------------------------

interface KeysTableProps {
  keys: ApiKeyListItem[];
  revoking: Set<string>;
  busyId: string | null;
  onRevoke: (id: string) => void;
  onReveal: (id: string) => void;
  onExtend: (key: ApiKeyListItem) => void;
}

function KeysTable({ keys, revoking, busyId, onRevoke, onReveal, onExtend }: KeysTableProps) {
  if (keys.length === 0) {
    return (
      <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
        No API keys yet. Create one above.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr>
            <th style={th}>Label</th>
            <th style={th}>Prefix</th>
            <th style={th}>Workspace</th>
            <th style={th}>Scope</th>
            <th style={th}>Status</th>
            <th style={th}>Expires</th>
            <th style={th}>Last used</th>
            <th style={th}>Created by</th>
            <th style={th}>Created</th>
            <th style={{ ...th, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const isRevoking = revoking.has(key.id);
            return (
              <tr key={key.id}>
                <td style={{ ...td, fontWeight: 600, color: 'var(--text-primary)', maxWidth: 180 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {key.label}
                  </div>
                </td>
                <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                  {key.keyPrefix}…
                </td>
                <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{key.workspace}</td>
                <td style={{ ...td, maxWidth: 160 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                    {scopeSummary(key)}
                  </div>
                </td>
                <td style={td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <StatusPill status={key.status} />
                    {key.expiringSoon && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          height: 20,
                          padding: '0 8px',
                          fontSize: 10.5,
                          fontWeight: 700,
                          borderRadius: 'var(--radius-full)',
                          background: 'var(--warning-soft)',
                          color: 'var(--warning-ink)',
                          border: '1px solid var(--warning-ink)',
                        }}
                        title="Expires soon — extend to keep it active"
                      >
                        soon
                      </span>
                    )}
                  </div>
                </td>
                <td
                  style={{
                    ...td,
                    whiteSpace: 'nowrap',
                    color:
                      key.status === 'expired'
                        ? 'var(--destructive-ink)'
                        : key.expiringSoon
                          ? 'var(--warning-ink)'
                          : 'var(--text-secondary)',
                    fontWeight: key.expiringSoon || key.status === 'expired' ? 600 : 400,
                  }}
                  title={key.expiresAt ?? 'non-expiring'}
                >
                  {key.expiresAt ? fmtDateTime(key.expiresAt) : 'never'}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtRelative(key.lastUsedAt)}</td>
                <td style={{ ...td, maxWidth: 140 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5 }}>
                    {key.createdBy}
                  </div>
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 11.5 }}>{fmtRelative(key.createdAt)}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {key.recoverable && key.status !== 'revoked' && (
                      <button
                        type="button"
                        disabled={busyId === key.id}
                        onClick={() => onReveal(key.id)}
                        style={{ ...btnGhost, opacity: busyId === key.id ? 0.55 : 1 }}
                      >
                        Reveal
                      </button>
                    )}
                    {key.status !== 'revoked' && (
                      <button
                        type="button"
                        disabled={busyId === key.id}
                        onClick={() => onExtend(key)}
                        style={{ ...btnGhost, opacity: busyId === key.id ? 0.55 : 1 }}
                      >
                        Extend
                      </button>
                    )}
                    {key.status !== 'revoked' && (
                      <button
                        type="button"
                        disabled={isRevoking}
                        onClick={() => onRevoke(key.id)}
                        style={{ ...btnDanger, opacity: isRevoking ? 0.55 : 1, cursor: isRevoking ? 'not-allowed' : 'pointer' }}
                      >
                        {isRevoking ? 'Revoking…' : 'Revoke'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast-style inline notification (no antd needed)
// ---------------------------------------------------------------------------

function InlineNotice({ text, kind, onDismiss }: { text: string; kind: 'success' | 'error'; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '8px 14px',
        marginBottom: 12,
        borderRadius: 'var(--radius-md)',
        background: kind === 'success' ? 'var(--success-soft)' : 'var(--destructive-soft)',
        color: kind === 'success' ? 'var(--success-ink)' : 'var(--destructive-ink)',
        fontSize: 12.5,
        fontWeight: 600,
        border: `1px solid ${kind === 'success' ? 'var(--success-ink)' : 'var(--destructive-ink)'}`,
      }}
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1, padding: 0 }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extend / renew expiry dialog
// ---------------------------------------------------------------------------

/** Local datetime-local value (YYYY-MM-DDTHH:mm) for `now + days`. */
function localDateTimeIn(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  // Shift by the local tz offset so toISOString's slice reads as local wall time.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

interface ExtendDialogProps {
  keyItem: ApiKeyListItem;
  busy: boolean;
  onClose: () => void;
  onSave: (expiresAt: string | null) => void;
}

function ExtendKeyDialog({ keyItem, busy, onClose, onSave }: ExtendDialogProps) {
  // Prefill with the current expiry (as local wall time) or now+30d.
  const [value, setValue] = useState<string>(() => {
    if (keyItem.expiresAt) {
      const d = new Date(keyItem.expiresAt);
      if (!Number.isNaN(d.getTime())) {
        return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
      }
    }
    return localDateTimeIn(30);
  });

  const fieldLabel: React.CSSProperties = {
    display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)',
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
  };
  const preset: React.CSSProperties = {
    fontSize: 11.5, fontWeight: 600, padding: '4px 10px', cursor: 'pointer',
    color: 'var(--brand)', background: 'var(--brand-soft)', border: '1px solid var(--brand)',
    borderRadius: 'var(--radius-sm)',
  };

  const saveDateTime = () => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return;
    onSave(d.toISOString());
  };

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        style={{ width: 'min(440px, 100%)', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Extend API key expiry"
      >
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <KeyRound size={18} style={{ color: 'var(--brand)', flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            Extend expiry — {keyItem.label}
          </span>
        </div>
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={fieldLabel} htmlFor="ak-extend">New expiry</label>
            <input
              id="ak-extend"
              type="datetime-local"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={busy}
              style={{ ...inputStyle, height: 34 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={preset} disabled={busy} onClick={() => setValue(localDateTimeIn(30))}>+30 days</button>
            <button type="button" style={preset} disabled={busy} onClick={() => setValue(localDateTimeIn(90))}>+90 days</button>
            <button type="button" style={preset} disabled={busy} onClick={() => setValue(localDateTimeIn(365))}>+1 year</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <button type="button" style={btnSecondary} disabled={busy} onClick={() => onSave(null)}>
              Make non-expiring
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={btnSecondary} disabled={busy} onClick={onClose}>Cancel</button>
              <button type="button" style={btnPrimary} disabled={busy} onClick={saveDateTime}>
                {busy ? 'Saving…' : 'Save expiry'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// ApiKeysTab — main export
// ---------------------------------------------------------------------------

export function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKeyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  // When a key has just been created, hold its plaintext for the one-time reveal.
  const [newKeyPlaintext, setNewKeyPlaintext] = useState<string | null>(null);

  const [revoking, setRevoking] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);
  // id with a reveal/extend request in flight (disables that row's buttons).
  const [busyId, setBusyId] = useState<string | null>(null);
  // The key being extended (opens the ExtendKeyDialog).
  const [extending, setExtending] = useState<ApiKeyListItem | null>(null);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const fetchKeys = useCallback(async () => {
    setLoadErr(null);
    try {
      const { keys: fetched } = await apiKeysClient.list();
      setKeys(fetched);
    } catch (e) {
      setLoadErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  const handleCreated = (key: ApiKeyListItem, plaintext: string) => {
    setModalOpen(false);
    setKeys((prev) => [key, ...prev]);
    setNewKeyPlaintext(plaintext);
    setNotice({ text: `Key "${key.label}" created.`, kind: 'success' });
  };

  const handleReveal = async (id: string) => {
    setBusyId(id);
    try {
      const { plaintext } = await apiKeysClient.reveal(id);
      setNewKeyPlaintext(plaintext);
    } catch (e) {
      setNotice({ text: `Reveal failed: ${(e as Error).message}`, kind: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const handleExtend = async (expiresAt: string | null) => {
    const target = extending;
    if (!target) return;
    setBusyId(target.id);
    try {
      await apiKeysClient.updateExpiry(target.id, expiresAt);
      setExtending(null);
      // Re-list so derived status/expiringSoon reflect the new expiry.
      await fetchKeys();
      setNotice({
        text: expiresAt
          ? `Key "${target.label}" expiry updated.`
          : `Key "${target.label}" is now non-expiring.`,
        kind: 'success',
      });
    } catch (e) {
      setNotice({ text: `Extend failed: ${(e as Error).message}`, kind: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const handleRevoke = async (id: string) => {
    const key = keys.find((k) => k.id === id);
    setRevoking((prev) => { const n = new Set(prev); n.add(id); return n; });
    try {
      await apiKeysClient.revoke(id);
      // Update the key status in local state rather than refetching.
      setKeys((prev) =>
        prev.map((k) =>
          k.id === id ? { ...k, status: 'revoked' as const, revokedAt: new Date().toISOString() } : k,
        ),
      );
      setNotice({ text: `Key "${key?.label ?? id}" revoked.`, kind: 'success' });
    } catch (e) {
      setNotice({ text: `Revoke failed: ${(e as Error).message}`, kind: 'error' });
    } finally {
      setRevoking((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  if (loadErr && !loading) {
    return (
      <div
        role="tabpanel"
        id="hub-tab-panel-api-keys"
        aria-labelledby="hub-tab-api-keys"
        style={{ ...card, marginTop: 16, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', padding: '14px 16px', fontSize: 13 }}
      >
        Could not load API keys: {loadErr}
      </div>
    );
  }

  return (
    <div
      role="tabpanel"
      id="hub-tab-panel-api-keys"
      aria-labelledby="hub-tab-api-keys"
      style={{ maxWidth: 1200, fontFamily: 'var(--font-sans)' }}
    >
      {/* Page header */}
      <header style={{ marginBottom: 18, marginTop: 16 }}>
        <div style={eyebrow}>Segment export · Service credentials</div>
        <h2 style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 9 }}>
          <KeyRound size={22} style={{ color: 'var(--brand)', flexShrink: 0 }} />
          API Keys
        </h2>
        <p style={{ margin: '5px 0 0', fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 640, lineHeight: 1.5 }}>
          Service keys for the public <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>/api/public/v1</code> segment-export surface.
          Each key carries a scoped workspace, optional segment/game restrictions, and an optional expiry.
          The secret is stored recoverably — reveal or copy it anytime, and extend its expiry without re-minting.
        </p>
      </header>

      {/* Inline notifications */}
      {notice && (
        <InlineNotice text={notice.text} kind={notice.kind} onDismiss={dismissNotice} />
      )}

      {/* One-time plaintext reveal — shown immediately after key creation */}
      {newKeyPlaintext && (
        <PlaintextReveal
          plaintext={newKeyPlaintext}
          onClose={() => setNewKeyPlaintext(null)}
        />
      )}

      {/* Keys card: toolbar + table */}
      <section style={{ ...card, overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border-card)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>
            Active &amp; revoked keys
            {!loading && (
              <span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                {keys.length} total · {keys.filter((k) => k.status === 'active').length} active
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            style={btnPrimary}
          >
            <KeyRound size={13} />
            Create key
          </button>
        </div>

        {/* Table body */}
        {loading ? (
          <div style={{ padding: '16px', fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
        ) : (
          <KeysTable
            keys={keys}
            revoking={revoking}
            busyId={busyId}
            onRevoke={(id) => void handleRevoke(id)}
            onReveal={(id) => void handleReveal(id)}
            onExtend={(key) => setExtending(key)}
          />
        )}
      </section>

      {extending && (
        <ExtendKeyDialog
          keyItem={extending}
          busy={busyId === extending.id}
          onClose={() => setExtending(null)}
          onSave={(expiresAt) => void handleExtend(expiresAt)}
        />
      )}

      {/* Collapsible pull-audit section */}
      <AuditSection />

      {/* Create key modal */}
      <CreateKeyModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
