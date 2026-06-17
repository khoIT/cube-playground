/**
 * ConceptChip — typed inline pill for glossary terms, metrics, fields, and
 * segments. Maintains a single icon vocabulary across chat, build, and catalog
 * surfaces so the object type is legible at a glance without reading the label.
 *
 * Icons reuse the lucide set established in `shared/concept-shell/type-icon`
 * (measure→BarChart3, dimension→Hash, segment→Users) so chips read as the same
 * type system as the catalog — plus lucide Info for glossary concepts. Earlier
 * versions used ad-hoc unicode glyphs (▦ ⓘ ＃ ◑) which rendered inconsistently
 * across fonts and had uneven widths that broke column alignment.
 *
 * Icon + color mapping:
 *   metric  BarChart3  --qb-measure-hover / --qb-measure-text
 *   concept Info       --info-soft / --info-ink
 *   field   Hash       --bg-muted / --text-secondary  (mono label, read-only feel)
 *   segment Users      --qb-segment-hover / --qb-segment-text
 *
 * Trust badge (optional, pill shape):
 *   certified   --success-soft / --success-ink
 *   draft       --muted-soft   / --muted-ink
 *   deprecated  --destructive-soft / --destructive-ink
 *
 * Renders as a react-router <Link> when `to` is provided, otherwise a <button>.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Info, Hash, Users, type LucideIcon } from 'lucide-react';
import type { Trust } from '../../api/glossary-client';

export type ConceptChipKind = 'metric' | 'concept' | 'field' | 'segment';

interface Props {
  kind: ConceptChipKind;
  label: string;
  to?: string;
  trust?: Trust;
  onClick?: React.MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>;
  className?: string;
  title?: string;
  /**
   * Color treatment. 'default' uses the per-kind type vocabulary (concept=blue,
   * metric=purple, …) shared with the catalog. 'brand' overrides any kind with
   * the brand accent (soft fill + brand border/ink) so the chip reads as a
   * highlighted, on-brand term. Used only in chat answers, where the glossary
   * highlight should pop on the warm page; the catalog/builder keep 'default'
   * so the type palette stays intact there.
   */
  tone?: 'default' | 'brand';
}

// Icon + color tokens per affordance vocabulary. Icons match the catalog's
// TypeIcon so the same object type looks the same everywhere.
const KIND_META: Record<ConceptChipKind, { Icon: LucideIcon; bg: string; ink: string; mono?: boolean }> = {
  metric:  { Icon: BarChart3, bg: 'var(--qb-measure-hover)',  ink: 'var(--qb-measure-text)' },
  concept: { Icon: Info,      bg: 'var(--info-soft)',          ink: 'var(--info-ink)' },
  field:   { Icon: Hash,      bg: 'var(--bg-muted)',           ink: 'var(--text-secondary)', mono: true },
  segment: { Icon: Users,     bg: 'var(--qb-segment-hover)',   ink: 'var(--qb-segment-text)' },
};

const TRUST_META: Record<Trust, { bg: string; ink: string; label: string }> = {
  certified:  { bg: 'var(--success-soft)',     ink: 'var(--success-ink)',     label: '✓ certified' },
  draft:      { bg: 'var(--muted-soft)',        ink: 'var(--muted-ink)',       label: 'draft' },
  deprecated: { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'deprecated' },
};

const BASE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 6px',
  borderRadius: 'var(--radius-sm)',
  fontSize: 12.5,
  fontFamily: 'var(--font-sans)',
  fontWeight: 500,
  lineHeight: '20px',
  textDecoration: 'none',
  border: '1px solid transparent',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

const TRUST_BADGE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 5px',
  marginLeft: 1,
  borderRadius: 'var(--radius-pill)',
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em',
  lineHeight: '15px',
};

export function ConceptChip({ kind, label, to, trust, onClick, className, title, tone = 'default' }: Props) {
  const { Icon, bg, ink, mono } = KIND_META[kind];
  const brandTone = tone === 'brand';

  // Brand tone (chat answers only) renders as a baseline underline-accent woven
  // into the running sentence — NOT a bordered inline-flex pill. Two reasons:
  //  1. it adds zero box height, so when prose wraps, a highlighted term that
  //     lands on the next row can never collide with the row above (a bordered
  //     pill is taller than the line box and overlaps on wrap);
  //  2. no leading icon — the highlight should blend into the text, not
  //     punctuate every term with a glyph. The underline grows into a soft fill
  //     on hover so the term still feels alive/clickable.
  const [hovered, setHovered] = React.useState(false);
  if (brandTone) {
    const underlineStyle: React.CSSProperties = {
      // `inline` (not inline-flex) so the term flows and wraps like a word.
      display: 'inline',
      // Shell-family tokens throughout so the term adapts in dark mode (the
      // accent line uses --shell-brand-border; keep the hover ink in-family).
      color: hovered ? 'var(--shell-brand-hover)' : 'var(--text-primary)',
      fontWeight: 600,
      fontFamily: 'var(--font-sans)',
      textDecoration: 'none',
      cursor: 'pointer',
      // Soft-orange baseline accent painted via background-image (not border or
      // text-decoration) so it adds no layout height and survives line wraps:
      // a 2px underline at rest that grows to a full soft fill on hover.
      backgroundImage:
        'linear-gradient(var(--shell-brand-border), var(--shell-brand-border))',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: '0 100%',
      backgroundSize: hovered ? '100% 100%' : '100% 2px',
      backgroundColor: hovered ? 'var(--brand-soft)' : 'transparent',
      padding: '0 1px',
      borderRadius: 2,
      transition: 'background-size .18s ease, background-color .18s ease, color .18s ease',
    };
    const hoverHandlers = {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onFocus: () => setHovered(true),
      onBlur: () => setHovered(false),
    };
    if (to) {
      return (
        <Link
          to={to}
          style={underlineStyle}
          onClick={onClick as React.MouseEventHandler<HTMLAnchorElement>}
          className={className}
          title={title}
          {...hoverHandlers}
        >
          {label}
        </Link>
      );
    }
    return (
      <button
        type="button"
        style={underlineStyle}
        onClick={onClick as React.MouseEventHandler<HTMLButtonElement>}
        className={className}
        title={title}
        {...hoverHandlers}
      >
        {label}
      </button>
    );
  }

  // Reached only for non-brand tones (brand returns above): the typed-pill
  // vocabulary shared with the catalog/builder — per-kind fill + icon.
  const chipStyle: React.CSSProperties = {
    ...BASE_STYLE,
    background: bg,
    color: ink,
    fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
    fontSize: mono ? 12 : 12.5,
  };

  const inner = (
    <>
      <Icon size={13} strokeWidth={2.5} style={{ flexShrink: 0, opacity: 0.85 }} aria-hidden />
      <span>{label}</span>
      {trust && (
        <span
          style={{
            ...TRUST_BADGE_STYLE,
            background: TRUST_META[trust].bg,
            color: TRUST_META[trust].ink,
          }}
          title={trust}
        >
          {TRUST_META[trust].label}
        </span>
      )}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        style={chipStyle}
        onClick={onClick as React.MouseEventHandler<HTMLAnchorElement>}
        className={className}
        title={title}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      style={chipStyle}
      onClick={onClick as React.MouseEventHandler<HTMLButtonElement>}
      className={className}
      title={title}
    >
      {inner}
    </button>
  );
}
