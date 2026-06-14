/**
 * Care-conversation attachment renderer. CS stores each attachment in the message
 * `files` array as one of two shapes:
 *   - a public CDN URL (Facebook / Zalo) — directly downloadable until the signed
 *     link expires (FB links live ~30–60 days, then 403);
 *   - a relative CS-portal storage key (in-game / web channel, e.g.
 *     `v4/production_portal_api_.../Screenshot_….jpg`) — not yet resolvable to a
 *     URL, pending the portal base host from CS.
 *
 * URLs render as a clickable image thumbnail (or a download chip for video/other);
 * a thumbnail that fails to load (expired link) degrades to a muted "unavailable"
 * chip. Relative keys render as an inert chip noting download isn't available yet.
 * External links carry rel="noreferrer" so we don't leak the analyst's referrer.
 */

import { ReactElement, useState } from 'react';
import { Paperclip, Download, ImageOff } from 'lucide-react';

const IMAGE_RE = /\.(jpe?g|png|gif|webp|bmp|svg)(\?|$)/i;

function isUrl(a: string): boolean {
  return /^https?:\/\//i.test(a);
}

/** Last path segment, query stripped, percent-decoded — the human filename. */
function cleanName(a: string): string {
  const noQuery = a.split('?')[0];
  const last = noQuery.split('/').pop() || a;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function chipStyle(mine: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    fontSize: 10,
    background: mine ? 'rgba(255,255,255,0.2)' : 'var(--bg-muted)',
    color: mine ? '#fff' : 'var(--text-secondary)',
    borderRadius: 'var(--radius-sm)',
    padding: '2px 7px',
    textDecoration: 'none',
    cursor: 'pointer',
  };
}

function Chip({ mine, name, icon, href, title }: { mine: boolean; name: string; icon: ReactElement; href?: string; title?: string }): ReactElement {
  const label = (
    <>
      {icon}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    </>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" title={title ?? name} style={chipStyle(mine)}>
        {label}
      </a>
    );
  }
  return (
    <span title={title ?? name} style={{ ...chipStyle(mine), cursor: 'default', opacity: 0.85 }}>
      {label}
    </span>
  );
}

export function CareHistoryAttachment({ raw, mine }: { raw: string; mine: boolean }): ReactElement {
  const [imgError, setImgError] = useState(false);
  const name = cleanName(raw);

  // Relative CS-portal key — not resolvable to a URL yet.
  if (!isUrl(raw)) {
    return <Chip mine={mine} name={name} icon={<Paperclip size={10} aria-hidden />} title={`${name} — stored in CS portal, download not available yet`} />;
  }

  // Public URL, image, still loadable → thumbnail that opens full-size in a tab.
  if (IMAGE_RE.test(raw) && !imgError) {
    return (
      <a href={raw} target="_blank" rel="noreferrer" title={name} style={{ display: 'inline-block', lineHeight: 0 }}>
        <img
          src={raw}
          alt={name}
          loading="lazy"
          onError={() => setImgError(true)}
          style={{
            width: 132,
            height: 96,
            objectFit: 'cover',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-card)',
            background: 'var(--bg-muted)',
          }}
        />
      </a>
    );
  }

  // Image that failed to load — almost always an expired signed link.
  if (IMAGE_RE.test(raw)) {
    return <Chip mine={mine} name={name} icon={<ImageOff size={10} aria-hidden />} title={`${name} — link expired / unavailable`} />;
  }

  // Non-image URL (video, etc.) → download chip.
  return <Chip mine={mine} name={name} icon={<Download size={10} aria-hidden />} href={raw} />;
}
