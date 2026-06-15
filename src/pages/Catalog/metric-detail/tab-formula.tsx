/**
 * TabFormula — visual breakdown of a metric's formula.
 *
 * Surfaces three shapes (measure / ratio / expression) with explicit
 * role labels (numerator / denominator / inputs) so the formula reads
 * left-to-right without needing the YAML schema.
 *
 * The bottom slot shows parameter info (e.g. LTV day picker) when the
 * metric exposes a parameter — leaves the refs themselves to the
 * formula canvas above and the Lineage tab for source navigation.
 */
import styled from 'styled-components';

import type { BusinessMetric } from '../metrics-tab/business-metric-types';

const Wrap = styled.section`
  padding: 20px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const Card = styled.div`
  padding: 20px 22px;
  border: 1px solid var(--border-card);
  border-radius: 12px;
  background: var(--bg-card);
`;

const SectionTitle = styled.h4`
  margin: 0 0 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
`;

const FormulaCanvas = styled.div`
  padding: 22px;
  border: 1px solid var(--border-card);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(63, 141, 255, 0.04), transparent);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  font-family: var(--font-mono, monospace);
`;

const TokenRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  justify-content: center;
`;

const Token = styled.span<{ tone?: 'blue' | 'green' | 'amber' | 'neutral' }>`
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  background: ${({ tone }) => {
    if (tone === 'green') return 'rgba(34, 197, 94, 0.10)';
    if (tone === 'amber') return 'rgba(245, 158, 11, 0.10)';
    if (tone === 'neutral') return 'rgba(0, 0, 0, 0.04)';
    return 'rgba(63, 141, 255, 0.10)';
  }};
  color: ${({ tone }) => {
    if (tone === 'green') return '#15803d';
    if (tone === 'amber') return '#a16207';
    if (tone === 'neutral') return 'var(--text-primary)';
    return '#1d4ed8';
  }};
`;

const TokenRole = styled.small`
  font-family: var(--font-sans, system-ui);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.7;
  margin-bottom: 2px;
`;

const Divider = styled.div`
  width: 60%;
  max-width: 320px;
  height: 1px;
  background: var(--border-card);
`;

const Op = styled.span`
  font-size: 22px;
  font-weight: 500;
  color: var(--text-muted);
`;

const ExpressionBlock = styled.pre`
  margin: 0;
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  line-height: 1.6;
  text-align: left;
  width: 100%;
  white-space: pre-wrap;
  word-break: break-word;
`;

const ParameterCard = styled(Card)`
  background: rgba(245, 158, 11, 0.05);
  border-color: rgba(245, 158, 11, 0.35);
`;

const ParameterRow = styled.div`
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px 16px;
  font-size: 13px;

  & > dt {
    color: var(--text-muted);
    font-weight: 500;
  }
  & > dd {
    margin: 0;
    color: var(--text-primary);
  }
`;

export function TabFormula({ metric }: { metric: BusinessMetric }) {
  const f = metric.formula;

  return (
    <Wrap>
      <Card>
        <SectionTitle>Formula</SectionTitle>
        <FormulaCanvas>
          {f.type === 'measure' && (
            <Token tone="blue">
              <TokenRole>Measure</TokenRole>
              {f.ref}
            </Token>
          )}
          {f.type === 'ratio' && (
            <>
              <Token tone="blue">
                <TokenRole>Numerator</TokenRole>
                {f.numerator}
              </Token>
              <Divider />
              <Token tone="green">
                <TokenRole>Denominator</TokenRole>
                {f.denominator}
              </Token>
            </>
          )}
          {f.type === 'expression' && (
            <>
              <ExpressionBlock>{f.expression}</ExpressionBlock>
              {f.inputs && f.inputs.length > 0 && (
                <TokenRow>
                  {f.inputs.map((ref, i) => (
                    <Token key={`${ref}-${i}`} tone="neutral">
                      <TokenRole>Input</TokenRole>
                      {ref}
                    </Token>
                  ))}
                </TokenRow>
              )}
            </>
          )}
        </FormulaCanvas>
      </Card>

      {metric.parameter && (
        <ParameterCard>
          <SectionTitle>Parameter</SectionTitle>
          <ParameterRow>
            <dt>Name</dt>
            <dd>{metric.parameter.label ?? metric.parameter.name}</dd>
            <dt>Options</dt>
            <dd>
              <code>{metric.parameter.options.join(', ')}</code>
            </dd>
            {metric.parameter.default !== undefined && (
              <>
                <dt>Default</dt>
                <dd>
                  <code>{metric.parameter.default}</code>
                </dd>
              </>
            )}
          </ParameterRow>
        </ParameterCard>
      )}

    </Wrap>
  );
}
