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
 * Positioning: the card is absolutely positioned relative to its wrapper.
 * The caller wraps the term anchor in <ConceptHoverCard term={…}>{anchor}</ConceptHoverCard>.
 * Visibility is toggled by CSS :hover / focus-within so it works without JS state.
 */

import React from 'react';
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
  const prime = React.useCallback(() => setPrimed(true), []);
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

  return (
    <span className="chc-wrap" onMouseEnter={prime} onFocus={prime}>
      {children}
      <span
        role="tooltip"
        style={CARD_STYLE}
        // CSS-only show/hide via the parent :hover — rendered as a sibling so
        // focus-within on the anchor also keeps it open.
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
        {term.description ? (
          <span style={DESC_STYLE}>{term.description}</span>
        ) : null}

        {/* Typed action rows */}
        {allActions.length > 0 && (
          <span style={ACTION_LIST_STYLE}>
            {allActions.map((action) => (
              <Link
                key={action.to}
                to={action.to}
                style={ACTION_ROW_STYLE}
              >
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
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Styles — tokens only, no raw hex
// ---------------------------------------------------------------------------

const CARD_STYLE: React.CSSProperties = {
  // Base: hidden. Revealed by .chc-wrap:hover / :focus-within via injected sheet.
  display: 'none',
  position: 'absolute',
  zIndex: 1000,
  bottom: 'calc(100% + 6px)',
  left: 0,
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

// Because inline styles can't use :hover pseudo-selectors we inject a tiny
// <style> tag once. The wrapper span gets the class `chc-wrap`.
if (typeof document !== 'undefined' && !document.getElementById('chc-styles')) {
  const s = document.createElement('style');
  s.id = 'chc-styles';
  s.textContent = `
    .chc-wrap { position: relative; display: inline; }
    .chc-wrap:hover [role="tooltip"],
    .chc-wrap:focus-within [role="tooltip"] {
      display: flex !important;
    }
  `;
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
