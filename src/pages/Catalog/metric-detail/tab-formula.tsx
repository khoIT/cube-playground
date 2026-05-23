import styled from 'styled-components';

import type { BusinessMetric } from '../metrics-tab/business-metric-types';

const Wrap = styled.section`
  padding: 20px 24px;
  font-size: 13px;
`;

const Box = styled.div`
  padding: 16px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 8px;
  background: var(--bg-card, #ffffff);
  font-family: var(--font-mono, monospace);
  font-size: 13px;
`;

const Ratio = styled.div`
  display: grid;
  grid-template-rows: auto 1px auto;
  gap: 6px;
  align-items: center;
  justify-items: center;
`;

const Bar = styled.div`
  width: 100%;
  height: 1px;
  background: var(--border-card, #e5e5e5);
`;

const Ref = styled.code`
  display: inline-block;
  padding: 6px 10px;
  background: rgba(63, 141, 255, 0.08);
  border-radius: 4px;
  color: #1d4ed8;
`;

const ParameterBox = styled.div`
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.06);
  font-size: 12px;
  color: var(--text-secondary, #525252);
`;

export function TabFormula({ metric }: { metric: BusinessMetric }) {
  const f = metric.formula;
  return (
    <Wrap>
      <Box>
        {f.type === 'measure' && <Ref>{f.ref}</Ref>}
        {f.type === 'ratio' && (
          <Ratio>
            <Ref>{f.numerator}</Ref>
            <Bar />
            <Ref>{f.denominator}</Ref>
          </Ratio>
        )}
        {f.type === 'expression' && <pre style={{ margin: 0 }}>{f.expression}</pre>}
      </Box>
      {metric.parameter && (
        <ParameterBox>
          <strong>Parameter:</strong> {metric.parameter.label ?? metric.parameter.name} ·{' '}
          options: <code>{metric.parameter.options.join(', ')}</code>
          {metric.parameter.default !== undefined && (
            <> · default: <code>{metric.parameter.default}</code></>
          )}
        </ParameterBox>
      )}
    </Wrap>
  );
}
