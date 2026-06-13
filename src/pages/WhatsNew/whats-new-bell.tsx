/**
 * WhatsNewBell — the single topbar bell (replaces the old AnomalyBell + chat
 * NotificationBell). Badge = count of unread feature announcements; clicking
 * opens a popover peek of the most recent releases with a "See all →" link to
 * the full /whats-new inbox.
 *
 * Read-state lives in useAnnouncements (shared with the page). Per product
 * decision, clicking a peek row only NAVIGATES — entries are marked read
 * explicitly on the inbox page, so a glance never silently clears the badge.
 */

import { useState } from 'react';
import { Popover } from 'antd';
import { Bell, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAnnouncements } from './use-announcements';

const PEEK_LIMIT = 6;

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function WhatsNewBell() {
  const { items, unreadCount } = useAnnouncements();
  const [open, setOpen] = useState(false);
  const recent = items.slice(0, PEEK_LIMIT);

  const content = (
    <div style={{ width: 320, fontFamily: 'var(--font-sans)' }}>
      <div style={{ padding: '4px 12px 8px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>What's New</div>
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {recent.length === 0 ? (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
            No announcements yet.
          </div>
        ) : (
          recent.map((a) => (
            <Link
              key={a.id}
              to="/whats-new"
              onClick={() => setOpen(false)}
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', textDecoration: 'none',
                borderTop: '1px solid var(--border-card)',
                background: a.read ? 'transparent' : 'var(--brand-soft)',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                  background: a.read ? 'transparent' : 'var(--brand)',
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.title}
                </span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>
                  {a.area} · {formatDate(a.date)}
                </span>
              </span>
            </Link>
          ))
        )}
      </div>
      <Link
        to="/whats-new"
        onClick={() => setOpen(false)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 12px',
          borderTop: '1px solid var(--border-card)', textDecoration: 'none', fontSize: 12.5, fontWeight: 600, color: 'var(--brand)',
        }}
      >
        See all <ArrowRight size={13} />
      </Link>
    </div>
  );

  return (
    <Popover trigger="click" placement="bottomRight" visible={open} onVisibleChange={setOpen} content={content}>
      <button
        type="button"
        aria-label={unreadCount > 0 ? `What's New — ${unreadCount} unread` : "What's New"}
        style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 32, height: 32, borderRadius: 'var(--radius-md)', border: '1px solid transparent',
          background: 'transparent', color: unreadCount > 0 ? 'var(--brand)' : 'var(--text-secondary)', cursor: 'pointer',
        }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, padding: '0 3px',
              borderRadius: 'var(--radius-full)', background: 'var(--brand)', color: 'var(--text-on-brand)',
              fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
              boxShadow: '0 0 0 2px var(--bg-card)',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </Popover>
  );
}
