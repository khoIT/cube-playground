/**
 * Shared styled-components for the MetricCard surface. Lifted into its own
 * module so each section sibling (similar-measures, joinable-with, how-to-
 * slice) can reuse the same visual primitives without re-defining them.
 */

import styled from 'styled-components';

export const Section = styled.section`
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-card);
  display: flex;
  flex-direction: column;
  gap: 8px;
  &:last-child {
    border-bottom: 0;
  }
`;

export const SectionTitle = styled.h3`
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

export const Description = styled.p`
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text-secondary);
`;

export const KvRow = styled.div`
  display: flex;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-secondary);
  padding: 2px 0;
`;

export const KvLabel = styled.span`
  color: var(--text-muted);
  min-width: 96px;
`;

export const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-secondary);
  padding: 3px 0;
`;

export const Code = styled.code`
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
`;

export const Chip = styled.span`
  display: inline-flex;
  padding: 1px 6px;
  border-radius: var(--pill-mono-radius);
  background: var(--pill-mono-bg);
  font-size: 10.5px;
  color: var(--text-secondary);
  margin-left: 6px;
`;

export const MutedText = styled.span`
  font-size: 12px;
  color: var(--text-muted);
`;

export const SqlPreview = styled.code`
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--pill-mono-bg);
  padding: 4px 8px;
  border-radius: 4px;
  display: block;
  overflow-x: auto;
  white-space: nowrap;
`;

export const Container = styled.main`
  max-width: 880px;
  margin: 32px auto;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 8px;
  overflow: hidden;
`;

export const Header = styled.header`
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border-card);
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const Fqn = styled.code`
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
`;

export const Subtitle = styled.span`
  font-size: 13px;
  color: var(--text-muted);
`;

export const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
`;

export const WizardChip = styled.span`
  display: inline-flex;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: var(--brand-soft);
  border: 1px solid var(--brand);
  color: var(--brand);
  font-size: 11px;
  font-weight: 600;
`;

export const Footer = styled.div`
  padding: 16px 24px;
  border-top: 1px solid var(--border-card);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

export const PrimaryBtn = styled.button`
  appearance: none;
  cursor: pointer;
  background: var(--brand);
  color: var(--text-on-brand);
  border: 0;
  border-radius: var(--radius-pill);
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  &:hover {
    background: var(--brand-hover);
  }
`;

export const SecondaryBtn = styled.button`
  appearance: none;
  cursor: pointer;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  &:hover {
    color: var(--brand);
    border-color: var(--brand);
  }
`;
