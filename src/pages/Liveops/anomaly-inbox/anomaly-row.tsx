/**
 * AnomalyRow — one row in the triage inbox.
 * Shows metric, severity badge, baseline → observed, timestamp, and row actions.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, BellOff, ExternalLink } from 'lucide-react';
import type { AnomalyRow as AnomalyRowData, AnomalySeverity } from './use-anomalies';
import { buildPlaygroundUrl } from './open-in-playground';

// ── Severity badge ────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<AnomalySeverity, { bg: string; text: string; label: string }> = {
  high: { bg: 'var(--destructive-soft)', text: 'var(--destructive-ink)', label: 'HIGH' },
  med:  { bg: 'var(--warning-soft)', text: 'var(--warning-ink)', label: 'MED'  },
  low:  { bg: 'var(--info-soft)', text: 'var(--info-ink)', label: 'LOW'  },
};

function SeverityBadge({ severity }: { severity: AnomalySeverity }) {
  const { bg, text, label } = SEVERITY_COLOR[severity];
  return (
    <span style={{
      padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700,
      letterSpacing: '0.04em', background: bg, color: text,
    }}>
      {label}
    </span>
  );
}

// ── Snooze popover ────────────────────────────────────────────────────────────

const SNOOZE_PRESETS: { label: string; hours: number }[] = [
  { label: '1 hour',   hours: 1  },
  { label: '4 hours',  hours: 4  },
  { label: '24 hours', hours: 24 },
];

interface SnoozePopoverProps {
  onSnooze: (until: string) => void;
  onClose: () => void;
}

function SnoozePopover({ onSnooze, onClose }: SnoozePopoverProps) {
  return (
    <div style={{
      position: 'absolute', top: '100%', right: 0, zIndex: 50,
      background: 'var(--bg-card)', border: '1px solid var(--border-card)',
      borderRadius: 8, padding: '6px 0', minWidth: 130, boxShadow: '0 4px 16px rgba(0,0,0,.12)',
    }}>
      {SNOOZE_PRESETS.map(({ label, hours }) => (
        <button
          key={hours}
          onClick={() => {
            const until = new Date(Date.now() + hours * 3_600_000).toISOString();
            onSnooze(until);
            onClose();
          }}
          style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: '7px 14px', background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Row actions ───────────────────────────────────────────────────────────────

interface RowActionsProps {
  anomaly: AnomalyRowData;
  onAck: () => Promise<void>;
  onSnooze: (until: string) => Promise<void>;
}

function RowActions({ anomaly, onAck, onSnooze }: RowActionsProps) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleAck = async () => {
    setBusy(true);
    try { await onAck(); } finally { setBusy(false); }
  };

  const handleSnooze = async (until: string) => {
    setBusy(true);
    try { await onSnooze(until); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
      <button
        title="Acknowledge"
        disabled={busy}
        onClick={handleAck}
        style={iconBtn}
      >
        <CheckCircle size={15} />
      </button>

      <button
        title="Snooze"
        disabled={busy}
        onClick={() => setSnoozeOpen((o) => !o)}
        style={iconBtn}
      >
        <BellOff size={15} />
      </button>

      {snoozeOpen && (
        <SnoozePopover
          onSnooze={handleSnooze}
          onClose={() => setSnoozeOpen(false)}
        />
      )}

      <a
        href={buildPlaygroundUrl(anomaly)}
        title="Open in Playground"
        style={{ ...iconBtn, textDecoration: 'none', display: 'flex', alignItems: 'center' }}
      >
        <ExternalLink size={15} />
      </a>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, borderRadius: 6, border: 'none',
  background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)',
};

// ── Main row ──────────────────────────────────────────────────────────────────

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

interface AnomalyRowProps {
  anomaly: AnomalyRowData;
  onAck: () => Promise<void>;
  onSnooze: (until: string) => Promise<void>;
}

export function AnomalyRow({ anomaly, onAck, onSnooze }: AnomalyRowProps) {
  const metricLabel = anomaly.metric.split('.').slice(1).join('.');

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '80px 1fr auto auto 110px',
      alignItems: 'center',
      gap: 12,
      padding: '10px 16px',
      borderBottom: '1px solid var(--border-card)',
    }}>
      {/* Severity */}
      <SeverityBadge severity={anomaly.severity} />

      {/* Metric + baseline→observed */}
      <div>
        <Link
          to={`/liveops/anomalies?metric=${encodeURIComponent(anomaly.metric)}`}
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}
        >
          {metricLabel}
        </Link>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {formatNum(anomaly.baseline)} → {formatNum(anomaly.observed)}
        </p>
      </div>

      {/* Timestamp */}
      <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {anomaly.ts.slice(0, 10)}
      </span>

      {/* Game chip */}
      <span style={{
        fontSize: 11, padding: '2px 6px', borderRadius: 4,
        background: 'var(--neutral-100)', color: 'var(--text-muted)',
      }}>
        {anomaly.game}
      </span>

      {/* Actions */}
      <RowActions anomaly={anomaly} onAck={onAck} onSnooze={onSnooze} />
    </div>
  );
}
