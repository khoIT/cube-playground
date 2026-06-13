/**
 * One release entry in the What's New changelog timeline (design Variant A).
 * Rail node + card: kind/area tag pills, date, markdown body, an optional
 * screenshot (styled placeholder when no image is set), and deep-link / mark-read
 * actions. Tokens only — no inline hex.
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

export function AnnouncementTimelineItem({
  item,
  onMarkRead,
}: {
  item: AnnouncementWithReadState;
  onMarkRead: (id: string) => void;
}) {
  const unread = !item.read;
  const k = KIND_STYLE[item.kind];

  return (
    <div style={{ position: 'relative', paddingBottom: 28 }}>
      {/* rail node */}
      <span
        aria-hidden
        style={{
          position: 'absolute', left: -30, top: 4, width: 16, height: 16, borderRadius: '50%',
          background: unread ? 'var(--brand)' : 'var(--bg-card)',
          border: `2px solid ${unread ? 'var(--brand)' : 'var(--border-strong)'}`,
          boxShadow: unread ? '0 0 0 4px var(--brand-soft)' : 'none',
        }}
      />
      <div
        style={{
          background: 'var(--bg-card)',
          border: `1px solid ${unread ? 'var(--brand)' : 'var(--border-card)'}`,
          borderRadius: 'var(--radius-xl)', padding: '16px 18px', boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 16, alignItems: 'start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <Pill bg={k.bg} ink={k.ink}>{KIND_LABEL[item.kind]}</Pill>
              <Pill bg="var(--muted-soft)" ink="var(--muted-ink)">{item.area}</Pill>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{formatDate(item.date)}</span>
            </div>
            <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{item.title}</h3>
            <div className="whats-new-md" style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // In-app links (href starting with "/") route through the SPA
                  // instead of triggering a full page reload, and mark the entry
                  // read like the primary deep-link button does.
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
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
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

          {/* screenshot — real asset if set, else a branded placeholder */}
          <div
            style={{
              borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-card)', aspectRatio: '16 / 9',
              overflow: 'hidden', background: 'linear-gradient(135deg, var(--bg-card), var(--bg-muted))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {item.image ? (
              <img src={item.image} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-card)', padding: '4px 10px', borderRadius: 'var(--radius-full)', border: '1px solid var(--border-card)' }}>
                {item.area}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
