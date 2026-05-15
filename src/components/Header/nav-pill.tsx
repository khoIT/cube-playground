import type { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import styled, { css } from 'styled-components';

type NavPillProps = {
  to: string;
  icon?: LucideIcon;
  active: boolean;
  children: ReactNode;
};

const PillLink = styled(Link)<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: background-color 120ms ease, color 120ms ease;

  ${(p) =>
    p.$active
      ? css`
          background-color: var(--brand);
          color: var(--text-on-brand);
          &:hover,
          &:focus {
            background-color: var(--brand-hover);
            color: var(--text-on-brand);
          }
        `
      : css`
          background-color: transparent;
          color: var(--text-secondary);
          &:hover,
          &:focus {
            background-color: var(--bg-muted);
            color: var(--text-primary);
          }
        `}
`;

export function NavPill({ to, icon: Icon, active, children }: NavPillProps) {
  return (
    <PillLink to={to} $active={active}>
      {Icon ? <Icon size={16} strokeWidth={2} /> : null}
      {children}
    </PillLink>
  );
}
