/**
 * EmptyState — shared empty-state component used across all DevAudit tabs.
 *
 * Usage:
 *   <EmptyState
 *     icon={<span>🗂</span>}
 *     title="No sessions yet"
 *     description="Start a chat to populate this view."
 *     cta={{ label: 'Go to Build', href: '#/build' }}
 *   />
 */
import React from 'react';
import { T } from '../../shell/theme';

interface CtaProps {
  label: string;
  onClick?: () => void;
  href?: string;
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  cta?: CtaProps;
  /** Optional testid for the root element */
  testId?: string;
}

const S = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 24px',
    textAlign: 'center' as const,
    gap: 8,
    fontFamily: T.fSans,
  } as React.CSSProperties,

  icon: {
    fontSize: 28,
    lineHeight: 1,
    marginBottom: 4,
    color: T.n400,
    userSelect: 'none' as const,
  } as React.CSSProperties,

  title: {
    fontSize: 13,
    fontWeight: 500,
    color: T.n600,
    margin: 0,
  } as React.CSSProperties,

  description: {
    fontSize: 11.5,
    color: T.n400,
    fontStyle: 'italic',
    margin: 0,
    maxWidth: 320,
    lineHeight: 1.5,
  } as React.CSSProperties,

  ctaBtn: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: 500,
    color: T.brand,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '2px 0',
    textDecoration: 'underline',
    fontFamily: T.fSans,
  } as React.CSSProperties,

  ctaLink: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: 500,
    color: T.brand,
    textDecoration: 'underline',
    fontFamily: T.fSans,
  } as React.CSSProperties,
};

export function EmptyState({ icon, title, description, cta, testId }: EmptyStateProps) {
  return (
    <div style={S.root} data-testid={testId ?? 'empty-state'}>
      {icon && <div style={S.icon}>{icon}</div>}
      <p style={S.title}>{title}</p>
      {description && <p style={S.description}>{description}</p>}
      {cta && (
        cta.href ? (
          <a href={cta.href} style={S.ctaLink}>{cta.label}</a>
        ) : (
          <button style={S.ctaBtn} onClick={cta.onClick}>{cta.label}</button>
        )
      )}
    </div>
  );
}
