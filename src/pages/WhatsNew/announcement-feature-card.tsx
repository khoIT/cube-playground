/**
 * One release rendered as a feature card (design Variant B): a full-width hero
 * image on top so every feature leads with a picture of what it does, then
 * kind/area tag pills, title, markdown body, and deep-link / mark-read actions.
 * The card lifts on hover (interactive affordance). Tokens only — no inline hex.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowRight, Check } from 'lucide-react';
import type { AnnouncementKind, AnnouncementWithReadState } from './announcement-types';

const KIND_LABEL: Record<AnnouncementKind, string> = { new: 'New', improved: 'Improved', fix: 'Fix' };
const KIND_STYLE: Record<AnnouncementKind, { bg: string; ink: string }> = {
  new: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
  improved: { bg: 'var(--info-soft)', ink: 'var(--info-ink)' },
  fix: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
};

function Pill({ bg, ink, children }: { bg: string; ink: string; children: React.ReactNode }) {
  return (
    <span style={{ background: bg, color: ink, borderRadius: 'var(--radius-full)', padding: '2px 8px', fontSize: 10.5, fontWeight: 600 }}>
      {children}
    </span>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function AnnouncementFeatureCard({
  item,
  onMarkRead,
}: {
  item: AnnouncementWithReadState;
  onMarkRead: (id: string) => void;
}) {
  const unread = !item.read;
  const k = KIND_STYLE[item.kind];
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${unread ? 'var(--brand)' : 'var(--border-card)'}`,
        borderRadius: 'var(--radius-2xl)', overflow: 'hidden',
        boxShadow: hovered ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        transform: hovered ? 'translateY(-2px)' : 'none',
        transition: 'box-shadow .15s ease, transform .15s ease',
      }}
    >
      {/* hero — every feature leads with a picture; branded placeholder if absent */}
      <div
        style={{
          aspectRatio: '21 / 9', borderBottom: '1px solid var(--border-card)', overflow: 'hidden',
          background: 'linear-gradient(135deg, var(--bg-card), var(--bg-muted))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {item.image ? (
          <img src={item.image} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-card)', padding: '4px 12px', borderRadius: 'var(--radius-full)', border: '1px solid var(--border-card)' }}>
            {item.area}
          </span>
        )}
      </div>

      <div style={{ padding: '16px 20px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {unread && <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--brand)' }} />}
          <Pill bg={k.bg} ink={k.ink}>{KIND_LABEL[item.kind]}</Pill>
          <Pill bg="var(--muted-soft)" ink="var(--muted-ink)">{item.area}</Pill>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{formatDate(item.date)}</span>
        </div>
        <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>{item.title}</h3>
        <div className="whats-new-md" style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // In-app links (href starting with "/") route through the SPA
              // instead of a full reload, and mark the entry read like the
              // primary deep-link button does.
              a: ({ href, children }) =>
                href && href.startsWith('/') ? (
                  <Link to={href} onClick={() => onMarkRead(item.id)} style={{ color: 'var(--brand)', fontWeight: 600 }}>
                    {children}
                  </Link>
                ) : (
                  <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)', fontWeight: 600 }}>
                    {children}
                  </a>
                ),
            }}
          >
            {item.body}
          </ReactMarkdown>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {item.deepLink && (
            <Link
              to={item.deepLink}
              onClick={() => onMarkRead(item.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
                background: 'var(--brand)', color: 'var(--text-on-brand)', fontSize: 12.5, fontWeight: 600,
                padding: '7px 14px', borderRadius: 'var(--radius-md)',
              }}
            >
              Open {item.area} <ArrowRight size={14} />
            </Link>
          )}
          {unread && (
            <button
              type="button"
              onClick={() => onMarkRead(item.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                background: 'var(--bg-card)', border: '1px solid var(--border-card)', color: 'var(--text-secondary)',
                fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)',
              }}
            >
              <Check size={14} /> Mark read
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
