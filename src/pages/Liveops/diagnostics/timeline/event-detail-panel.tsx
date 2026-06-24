/**
 * EventDetailPanel — side panel showing annotation metadata.
 *
 * Appears when the user clicks a flag on the timeline chart or a row in the
 * event list. Shows type badge, title, date range, URL, and action buttons
 * (edit / delete). Caller owns edit/delete handlers.
 * Token-only styles; no raw hex.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { X, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import type { ChartAnnotation, AnnotationType } from '../../../../api/chart-annotations';

// ── Type badge colors (semantic tokens) ──────────────────────────────────────

const TYPE_BADGE: Record<AnnotationType, { bg: string; ink: string; label: string }> = {
  patch:    { bg: 'var(--info-soft)',        ink: 'var(--info-ink)',        label: 'Patch' },
  event:    { bg: 'var(--success-soft)',     ink: 'var(--success-ink)',     label: 'Event' },
  campaign: { bg: 'var(--muted-soft)',       ink: 'var(--brand)',           label: 'Campaign' },
  incident: { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'Incident' },
};

// ── Props ────────────────────────────────────────────────────────────────────

export interface EventDetailPanelProps {
  annotation: ChartAnnotation;
  onClose: () => void;
  onEdit: (annotation: ChartAnnotation) => void;
  onDelete: (id: number) => void;
  /** Illustrative impact rows — present only for mock events. When set, the
   *  panel renders them under a "Mocked" badge and hides edit/delete (a mock
   *  isn't a real row). */
  mockStats?: Array<[string, string]>;
}

// ── Component ────────────────────────────────────────────────────────────────

export function EventDetailPanel({ annotation, onClose, onEdit, onDelete, mockStats }: EventDetailPanelProps) {
  const badge = TYPE_BADGE[annotation.type] ?? TYPE_BADGE.event;
  const isMock = mockStats != null;

  const dateRange = annotation.ends_at
    ? `${annotation.starts_at} → ${annotation.ends_at}`
    : annotation.starts_at;

  return (
    <aside
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-md)',
        padding: 20,
        fontFamily: 'var(--font-sans)',
        minWidth: 260,
        maxWidth: 340,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {/* Header row: badge (+ mocked pill) + close */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-block',
              padding: '2px 10px',
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              background: badge.bg,
              color: badge.ink,
            }}
          >
            {badge.label}
          </span>
          {isMock && (
            <span
              title="Illustrative example — impact figures are not measured."
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                borderRadius: 99,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                background: 'var(--warning-soft)',
                color: 'var(--warning-ink)',
              }}
            >
              Mocked
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: 'var(--text-primary)',
          lineHeight: 1.3,
        }}
      >
        {annotation.title}
      </div>

      {/* Date range */}
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-secondary)', marginRight: 6 }}>Date</span>
        {dateRange}
      </div>

      {/* URL */}
      {annotation.url && (
        <a
          href={annotation.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 12,
            color: 'var(--brand)',
            textDecoration: 'none',
          }}
        >
          Reference link <ExternalLink size={12} />
        </a>
      )}

      {/* Created by (real events only) */}
      {!isMock && annotation.created_by && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Added by {annotation.created_by}
        </div>
      )}

      {/* Mock impact stats */}
      {isMock && mockStats && (
        <div>
          {mockStats.map(([label, value]) => (
            <div
              key={label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid var(--border-card)',
                fontSize: 13,
              }}
            >
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <b style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</b>
            </div>
          ))}
        </div>
      )}

      {/* Actions — mock events offer a (placeholder) drill-in; real events edit/delete */}
      {isMock ? (
        <Link
          to="/segments"
          style={{
            marginTop: 4,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--brand)',
            textDecoration: 'none',
          }}
        >
          View affected segments →
        </Link>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={() => onEdit(annotation)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <Pencil size={12} /> Edit
          </button>
          <button
            onClick={() => onDelete(annotation.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              border: '1px solid var(--destructive-soft)',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              color: 'var(--destructive-ink)',
              cursor: 'pointer',
            }}
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      )}
    </aside>
  );
}
