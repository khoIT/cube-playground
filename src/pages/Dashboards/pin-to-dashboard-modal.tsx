/**
 * Modal for pinning a playground query to a dashboard.
 * Shows existing dashboards + "Create new…" tab.
 * 409 tile_cap_exceeded surfaces as a readable error message.
 * Create form is extracted to pin-modal-create-form.tsx.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SegmentApiError } from '../../api/api-client';
import { dashboardsClient, type VizType } from '../../api/dashboards-client';
import { useDashboards } from './use-dashboards';
import { PinModalCreateForm, type CreateFormValues } from './pin-modal-create-form';

interface PinToDashboardModalProps {
  gameId: string;
  queryJson: string;
  vizType: VizType;
  onClose: () => void;
  onPinned?: () => void;
}

type Mode = 'pick' | 'create';

// ── Styles ────────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const dialogStyle: React.CSSProperties = {
  background: 'var(--bg-card, #fff)', borderRadius: 12,
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)', width: 440,
  maxWidth: '95vw', maxHeight: '85vh', overflowY: 'auto',
  padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', borderRadius: 6,
  border: '1px solid var(--border-card, #d1d5db)', fontSize: 13,
  boxSizing: 'border-box', outline: 'none',
};
const btnPrimary: React.CSSProperties = {
  background: 'var(--brand, #6366f1)', color: '#fff', border: 'none',
  borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  background: 'transparent', color: 'var(--text-primary, #111)',
  border: '1px solid var(--border-card, #d1d5db)', borderRadius: 6,
  padding: '7px 16px', fontSize: 13, cursor: 'pointer',
};

export function PinToDashboardModal({
  gameId, queryJson, vizType, onClose, onPinned,
}: PinToDashboardModalProps) {
  const { dashboards, loading: listLoading } = useDashboards(gameId);
  const [mode, setMode] = useState<Mode>('pick');
  const [selectedSlug, setSelectedSlug] = useState('');
  const [tileTitle, setTileTitle] = useState('Query result');
  const [createValues, setCreateValues] = useState<CreateFormValues>({ title: '', slug: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Auto-select first dashboard when list loads
  useEffect(() => {
    if (dashboards.length > 0 && !selectedSlug) setSelectedSlug(dashboards[0].slug);
  }, [dashboards, selectedSlug]);

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const addTileToExisting = useCallback(async () => {
    if (!selectedSlug) { setError('Pick a dashboard first'); return; }
    setSubmitting(true); setError(null);
    try {
      await dashboardsClient.addTile(selectedSlug, gameId, {
        title: tileTitle.trim() || 'Query result',
        query_json: queryJson, viz_type: vizType,
        position_json: JSON.stringify({ x: 0, y: 999, w: 4, h: 3 }),
      });
      onPinned?.(); onClose();
    } catch (err) {
      if (err instanceof SegmentApiError && err.status === 409) {
        setError('Dashboard is full (8 tiles max). Remove a tile first.');
      } else {
        setError((err as Error).message ?? 'Unexpected error.');
      }
    } finally { setSubmitting(false); }
  }, [selectedSlug, gameId, queryJson, vizType, tileTitle, onPinned, onClose]);

  const createAndPin = useCallback(async () => {
    const { title, slug } = createValues;
    if (!title.trim()) { setError('Dashboard title is required'); return; }
    if (!slug) { setError('Slug is required'); return; }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setError('Slug must be lowercase letters, digits and hyphens only'); return;
    }
    setSubmitting(true); setError(null);
    try {
      await dashboardsClient.create({ game: gameId, slug, title: title.trim() });
      await dashboardsClient.addTile(slug, gameId, {
        title: tileTitle.trim() || 'Query result',
        query_json: queryJson, viz_type: vizType,
        position_json: JSON.stringify({ x: 0, y: 0, w: 4, h: 3 }),
      });
      onPinned?.(); onClose();
    } catch (err) {
      if (err instanceof SegmentApiError && err.status === 409) {
        setError('A dashboard with this slug already exists for this game.');
      } else {
        setError((err as Error).message ?? 'Unexpected error.');
      }
    } finally { setSubmitting(false); }
  }, [createValues, gameId, queryJson, vizType, tileTitle, onPinned, onClose]);

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Pin to dashboard" style={dialogStyle}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Pin to dashboard</span>
          <button aria-label="Close" onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>

        {/* Tile title */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Tile title</label>
          <input ref={titleRef} style={inputStyle} value={tileTitle}
            onChange={(e) => setTileTitle(e.target.value)} placeholder="Query result" />
        </div>

        {/* Viz type (read-only — inferred from query context) */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Visualization</label>
          <select style={{ ...inputStyle, background: 'var(--bg-card, #fff)' }} value={vizType} disabled>
            <option value="table">Table</option>
            <option value="kpi">KPI</option>
            <option value="line">Line chart</option>
            <option value="bar">Bar list</option>
          </select>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
            Auto-detected from query context
          </span>
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border-card,#e5e7eb)', paddingBottom: 8 }}>
          {(['pick', 'create'] as const).map((m) => (
            <button key={m}
              style={{ ...btnSecondary, borderBottom: mode === m ? '2px solid var(--brand,#6366f1)' : undefined, fontWeight: mode === m ? 700 : 400 }}
              onClick={() => { setMode(m); setError(null); }}>
              {m === 'pick' ? 'Existing dashboard' : 'Create new…'}
            </button>
          ))}
        </div>

        {/* Pick existing */}
        {mode === 'pick' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {listLoading && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</span>}
            {!listLoading && dashboards.length === 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No dashboards yet — create one.</span>
            )}
            {dashboards.map((d) => (
              <label key={d.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="radio" name="dashboard-pick" value={d.slug}
                  checked={selectedSlug === d.slug} onChange={() => setSelectedSlug(d.slug)} />
                <span style={{ fontWeight: 600 }}>{d.title}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>/{d.slug}</span>
              </label>
            ))}
          </div>
        )}

        {/* Create new */}
        {mode === 'create' && (
          <PinModalCreateForm onChange={setCreateValues} />
        )}

        {/* Error */}
        {error && (
          <div style={{ fontSize: 12, color: 'var(--danger,#dc2626)', background: 'var(--bg-danger,#fef2f2)', borderRadius: 6, padding: '6px 10px' }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button style={btnSecondary} onClick={onClose} disabled={submitting}>Cancel</button>
          <button style={{ ...btnPrimary, opacity: submitting ? 0.6 : 1 }} disabled={submitting}
            onClick={mode === 'pick' ? addTileToExisting : createAndPin}>
            {submitting ? 'Pinning…' : 'Pin'}
          </button>
        </div>
      </div>
    </div>
  );
}
