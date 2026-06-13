/**
 * WhatsNewPage — /whats-new
 *
 * Feature-announcement inbox rendered as feature cards (design Variant B): each
 * release leads with a hero picture so users see what it does before diving in.
 * Content is bundled markdown (announcements-content.ts); per-user read-state
 * comes from useAnnouncements (server-backed). Header mirrors the design-system
 * page pattern (icon + 20px/700 title, eyebrow); tokens only.
 */

import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useAnnouncements } from './use-announcements';
import { AnnouncementFeatureCard } from './announcement-feature-card';

type Filter = 'all' | 'unread';

export function WhatsNewPage() {
  const { items, unreadCount, markRead, markAllRead } = useAnnouncements();
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(
    () => (filter === 'unread' ? items.filter((i) => !i.read) : items),
    [items, filter],
  );

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 6 }}>
        <span
          style={{
            width: 40, height: 40, borderRadius: 'var(--radius-xl)', background: 'var(--brand-soft)', color: 'var(--brand)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          <Sparkles size={22} />
        </span>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--brand)', marginBottom: 2 }}>
            Product updates
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>What's New</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--text-muted)' }}>
            The latest features, with a peek at each one before you dive in
            {unreadCount > 0 ? <> · <strong style={{ color: 'var(--text-secondary)' }}>{unreadCount} unread</strong></> : null}.
          </p>
        </div>
      </div>

      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 18px' }}>
        <span style={{ display: 'inline-flex', background: 'var(--bg-muted)', borderRadius: 'var(--radius-full)', padding: 3 }}>
          {(['all', 'unread'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              style={{
                border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600,
                padding: '5px 12px', borderRadius: 'var(--radius-full)', textTransform: 'capitalize',
                background: filter === f ? 'var(--bg-card)' : 'transparent',
                color: filter === f ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: filter === f ? 'var(--shadow-sm)' : 'none',
              }}
            >
              {f}
            </button>
          ))}
        </span>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--brand)' }}
          >
            Mark all read
          </button>
        )}
      </div>

      {/* feature cards */}
      {visible.length === 0 ? (
        <div
          style={{
            padding: 32, textAlign: 'center', background: 'var(--bg-card)', border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-lg)', color: 'var(--text-muted)', fontSize: 13,
          }}
        >
          {filter === 'unread' ? "You're all caught up — no unread updates." : 'No announcements yet.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 18 }}>
          {visible.map((item) => (
            <AnnouncementFeatureCard key={item.id} item={item} onMarkRead={markRead} />
          ))}
        </div>
      )}
    </div>
  );
}
