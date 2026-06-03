/**
 * ConceptHoverCard — floating definition + typed-action panel for glossary terms.
 *
 * Shows on hover/focus of a term anchor. Content layers:
 *   1. Term label + concept glyph + trust badge
 *   2. One-line definition (description)
 *   3. Sync typed actions from conceptTypedActions() — Define / Slice / See metric
 *   4. Async segment + metric rows from the relations endpoint (via useConceptResolution)
 *
 * Degrades gracefully: if relations fail or return empty, only sync actions render.
 * Total actions capped at 6 to keep the card compact.
 *
 * Positioning: the card is rendered into a document.body portal with viewport-
 * fixed coordinates measured from the anchor on open. Fixed-to-viewport means it
 * escapes any ancestor scroll container's clip (the glossary list, the chat
 * transcript) — an absolutely-positioned card inside `overflow:auto` would be
 * cropped to an empty sliver on the top/edge rows. Open/close is JS-driven with a
 * short close grace period so the pointer can travel the gap onto the card.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { GlossaryTerm } from '../../api/glossary-client';
import { conceptTypedActions, resolveConceptHref, toConceptRef } from '../../pages/Catalog/glossary/resolve-concept';
import { useConceptResolution } from './use-concept-resolution';
import type { Trust } from '../../api/glossary-client';

const MAX_ACTIONS = 6;

interface Props {
  term: GlossaryTerm;
  children: React.ReactNode;
}

// Trust badge rendering — reuses the same token pairs as ConceptChip.
const TRUST_STYLE: Record<Trust, React.CSSProperties> = {
  certified:  { background: 'var(--success-soft)',     color: 'var(--success-ink)' },
  draft:      { background: 'var(--muted-soft)',        color: 'var(--muted-ink)' },
  deprecated: { background: 'var(--destructive-soft)', color: 'var(--destructive-ink)' },
};
const TRUST_LABEL: Record<Trust, string> = {
  certified: '✓ certified',
  draft: 'draft',
  deprecated: 'deprecated',
};

const ACTION_GLYPH: Record<string, string> = {
  define:  'ⓘ',
  slice:   '＃',
  metric:  '▦',
  segment: '◑',
};

function TrustBadge({ trust }: { trust: Trust }) {
  return (
    <span
      style={{
        ...TRUST_STYLE[trust],
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 'var(--radius-pill)',
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        lineHeight: '16px',
        flexShrink: 0,
      }}
    >
      {TRUST_LABEL[trust]}
    </span>
  );
}

export function ConceptHoverCard({ term, children }: Props) {
  // Resolve the canonical namespaced ref for async cross-layer relations.
  // Normalizes payer-tier terms (primaryCatalogId=null → data_model/<filter member>)
  // and bare-member terms (mf_users.country → data_model/mf_users.country) so the
  // "Open segment" rows actually resolve for the showcase concepts.
  const conceptRef = toConceptRef(term);
  // Hover-gate the cross-layer fetch: only request relations once the user
  // actually interacts with the anchor, so a message full of concept chips
  // doesn't fire N requests on render. Stays primed after first interaction;
  // the module cache then serves repeats for free.
  const [primed, setPrimed] = React.useState(false);
  const { data: relations } = useConceptResolution(primed ? conceptRef : null);

  // Sync actions derived from term fields.
  const syncActions = conceptTypedActions(term);

  // Async segment actions from the relations endpoint.
  const asyncSegmentActions = (relations?.segments ?? []).map((seg) => ({
    kind: 'segment' as const,
    label: `Open segment: ${seg.name}`,
    to: `/segments/${encodeURIComponent(seg.id)}`,
    glyph: '◑',
  }));

  // Merge, deduplicate by `to`, cap at MAX_ACTIONS.
  const allActions = [...syncActions, ...asyncSegmentActions].slice(0, MAX_ACTIONS);

  const primaryHref = resolveConceptHref(term);

  // --- Open/close state + viewport positioning ----------------------------
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<number | null>(null);
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null);

  const show = React.useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setPrimed(true);
    setOpen(true);
  }, []);

  // Grace period lets the pointer cross the 6px gap from anchor onto the card
  // without the card vanishing mid-travel.
  const scheduleClose = React.useCallback(() => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  }, []);

  React.useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  // Measure the anchor + card and place the card in the viewport. Prefers below
  // the anchor; flips above when below would overflow the viewport bottom and
  // there is more room above. Clamps horizontally to stay on-screen.
  const reposition = React.useCallback(() => {
    const anchor = anchorRef.current;
    const card = cardRef.current;
    if (!anchor || !card) return;
    const a = anchor.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    const roomBelow = window.innerHeight - a.bottom;
    const placeAbove = roomBelow < c.height + gap + margin && a.top > roomBelow;
    const top = placeAbove ? Math.max(margin, a.top - gap - c.height) : a.bottom + gap;
    const maxLeft = window.innerWidth - c.width - margin;
    const left = Math.max(margin, Math.min(a.left, maxLeft));
    setCoords({ top, left });
  }, []);

  // Position before paint so the card never flashes at the wrong spot. Re-runs
  // when async relations change the card height. While open, follow scroll/resize
  // so a fixed-positioned card doesn't drift away from a moving anchor.
  React.useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    reposition();
    const onMove = () => reposition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, reposition, allActions.length, term.description]);

  const card = open ? (
    <div
      ref={cardRef}
      role="tooltip"
      onMouseEnter={show}
      onMouseLeave={scheduleClose}
      style={{
        ...CARD_STYLE,
        top: coords?.top ?? 0,
        left: coords?.left ?? 0,
        // Hidden for the pre-measure frame to avoid a top-left flash.
        visibility: coords ? 'visible' : 'hidden',
      }}
    >
      {/* Header: label + glyph + trust */}
      <span style={HEADER_STYLE}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
          <span aria-hidden style={{ marginRight: 4 }}>ⓘ</span>
          {term.label}
        </span>
        <TrustBadge trust={term.trust} />
      </span>

      {/* Definition */}
      {term.description ? <span style={DESC_STYLE}>{term.description}</span> : null}

      {/* Typed action rows */}
      {allActions.length > 0 && (
        <span style={ACTION_LIST_STYLE}>
          {allActions.map((action) => (
            <Link key={action.to} to={action.to} className="chc-action" style={ACTION_ROW_STYLE}>
              <span aria-hidden style={{ width: 16, textAlign: 'center', flexShrink: 0 }}>
                {ACTION_GLYPH[action.kind] ?? action.glyph}
              </span>
              <span style={{ flex: 1 }}>{action.label}</span>
            </Link>
          ))}
        </span>
      )}

      {/* Footer deep-link when no other actions differentiate the primary href */}
      {allActions.length === 0 && (
        <Link to={primaryHref} style={FOOTER_LINK_STYLE}>
          View in glossary →
        </Link>
      )}
    </div>
  ) : null;

  return (
    <span
      ref={anchorRef}
      className="chc-wrap"
      onMouseEnter={show}
      onMouseLeave={scheduleClose}
      onFocus={show}
      onBlur={scheduleClose}
    >
      {children}
      {card && typeof document !== 'undefined' ? createPortal(card, document.body) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Styles — tokens only, no raw hex
// ---------------------------------------------------------------------------

const CARD_STYLE: React.CSSProperties = {
  // Fixed to the viewport (coords measured from the anchor) so the card escapes
  // any ancestor scroll container's overflow clip. Show/hide is JS-driven.
  display: 'flex',
  position: 'fixed',
  zIndex: 1000,
  minWidth: 220,
  maxWidth: 320,
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-md)',
  padding: '10px 12px',
  flexDirection: 'column',
  gap: 6,
  fontFamily: 'var(--font-sans)',
};

// The wrapper stays inline so it doesn't disturb surrounding text flow.
if (typeof document !== 'undefined' && !document.getElementById('chc-styles')) {
  const s = document.createElement('style');
  s.id = 'chc-styles';
  // Action rows highlight on hover so users can see which typed action is
  // focused. Inline styles can't express :hover, so the rule lives here;
  // tokens keep it dark-mode aware. transition smooths the enter/leave.
  s.textContent = `.chc-wrap { display: inline; }
.chc-action { transition: background 120ms ease, color 120ms ease; }
.chc-action:hover { background: var(--bg-muted); color: var(--text-primary); }`;
  document.head.appendChild(s);
}

const HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 4,
};

const DESC_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
  marginBottom: 6,
  // Clamp to 3 lines so the card stays compact.
  overflow: 'hidden',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical' as const,
  // display: '-webkit-box' conflicts with the block display — use max-height instead.
  maxHeight: '4.5em',
};

const ACTION_LIST_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  borderTop: '1px solid var(--border-card)',
  paddingTop: 6,
  marginTop: 2,
};

const ACTION_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px',
  borderRadius: 'var(--radius-sm)',
  fontSize: 12,
  color: 'var(--text-secondary)',
  textDecoration: 'none',
  background: 'transparent',
  cursor: 'pointer',
};

const FOOTER_LINK_STYLE: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  fontSize: 12,
  color: 'var(--brand)',
  textDecoration: 'none',
};
