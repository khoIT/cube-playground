/**
 * Shared layout primitives for settings sections. Each settings tab renders a
 * <SectionCard> with <SectionHead> + content. Kept lightweight so individual
 * tab files own their domain logic without duplicating the card chrome.
 */

import styled from 'styled-components';

export const SectionCard = styled.section`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-xs);
  padding: 24px 26px;
`;

export const SectionHead = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
`;

export const SectionTitle = styled.h2`
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
`;

export const SectionHint = styled.p`
  margin: 0;
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.45;
`;

export const ResetButton = styled.button`
  align-self: flex-start;
  height: 28px;
  padding: 0 12px;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;

  &:hover,
  &:focus-visible {
    color: var(--brand);
    border-color: var(--brand);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
