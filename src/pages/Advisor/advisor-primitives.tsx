/**
 * Shared primitive UI atoms for the Advisor pages.
 * All use design tokens — no inline hex codes.
 */
import React from 'react';

// ─── Pill ──────────────────────────────────────────────────────────────────

interface PillProps {
  bg: string;
  ink: string;
  children: React.ReactNode;
  title?: string;
  onClick?: () => void;
}

export function Pill({ bg, ink, children, title, onClick }: PillProps) {
  return (
    <span
      title={title}
      onClick={onClick}
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        borderRadius: 'var(--radius-full)',
        padding: '2px 8px',
        background: bg,
        color: ink,
        whiteSpace: 'nowrap',
        cursor: onClick ? 'pointer' : 'default',
        display: 'inline-block',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {children}
    </span>
  );
}

// ─── Btn ──────────────────────────────────────────────────────────────────

interface BtnProps {
  children: React.ReactNode;
  kind?: 'primary' | 'ghost';
  onClick?: () => void;
  sm?: boolean;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
}

export function Btn({ children, kind = 'ghost', onClick, sm, disabled, title, type = 'button' }: BtnProps) {
  const base: React.CSSProperties = {
    fontFamily: 'var(--font-sans)',
    fontSize: sm ? 12 : 13.5,
    fontWeight: 600,
    padding: sm ? '6px 11px' : '10px 18px',
    borderRadius: 'var(--radius-md)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: '1px solid transparent',
    opacity: disabled ? 0.45 : 1,
    lineHeight: 1.4,
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--brand)', color: 'var(--text-on-brand)', borderColor: 'var(--brand)' },
    ghost: {
      background: 'var(--bg-card)',
      color: 'var(--text-secondary)',
      borderColor: 'var(--border-strong)',
    },
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      style={{ ...base, ...variants[kind] }}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </button>
  );
}

// ─── Card wrapper ─────────────────────────────────────────────────────────

export const CARD_STYLE: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-xl)',
  boxShadow: 'var(--shadow-xs)',
};

// ─── Eyebrow label ────────────────────────────────────────────────────────

export const EYEBROW_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-sans)',
};

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ ...EYEBROW_STYLE, ...style }}>{children}</div>;
}

// ─── Section divider ─────────────────────────────────────────────────────

export function Divider() {
  return <div style={{ height: 1, background: 'var(--border-card)', margin: '0' }} />;
}

// ─── Pulse animation wrapper ─────────────────────────────────────────────

export function PulsingRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 7,
        alignItems: 'center',
        color: 'var(--brand)',
        fontSize: 12.5,
        animation: 'advisor-pulse 1s infinite',
      }}
    >
      {children}
      <style>{`
        @keyframes advisor-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>
    </div>
  );
}

// ─── Mini horizontal bar chart (treatment vs hold-out) ───────────────────

interface MiniBarProps {
  label: string;
  value: number;
  max: number;
  color: string;
  unit: string;
}

function MiniBar({ label, value, max, color, unit }: MiniBarProps) {
  const widthPct = Math.max(3, Math.round((value / max) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{ width: 78, fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 18,
          background: 'var(--bg-muted)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${widthPct}%`,
            height: '100%',
            background: color,
            borderRadius: 'var(--radius-sm)',
          }}
        />
      </div>
      <span style={{ width: 54, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
        {value}
        {unit}
      </span>
    </div>
  );
}

interface MiniBarsProps {
  a: number;
  b: number;
  labelA: string;
  labelB: string;
  unit: string;
  max: number;
}

export function MiniBars({ a, b, labelA, labelB, unit, max }: MiniBarsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
      <MiniBar label={labelA} value={a} max={max} color="var(--brand)" unit={unit} />
      <MiniBar label={labelB} value={b} max={max} color="var(--fill-muted)" unit={unit} />
    </div>
  );
}
