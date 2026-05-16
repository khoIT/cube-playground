import { Suspense, lazy } from 'react';
import styled from 'styled-components';

// Lazy-load Recharts — it's heavy, and the sparkline only renders on step 3.
const LineChart = lazy(() =>
  import('recharts').then((m) => ({ default: m.LineChart })),
);
const Line = lazy(() =>
  import('recharts').then((m) => ({ default: m.Line })),
);
const ResponsiveContainer = lazy(() =>
  import('recharts').then((m) => ({ default: m.ResponsiveContainer })),
);

const Wrapper = styled.div`
  width: 100%;
  height: 60px;
`;

const Placeholder = styled.div`
  width: 100%;
  height: 60px;
  background: var(--bg-muted);
  border-radius: 4px;
`;

interface SparklineProps {
  data: Array<{ x: string; y: number }>;
}

export function Sparkline({ data }: SparklineProps) {
  if (!data || data.length === 0) return <Placeholder aria-hidden />;
  return (
    <Wrapper>
      <Suspense fallback={<Placeholder />}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 4 }}>
            <Line
              type="monotone"
              dataKey="y"
              stroke="var(--brand)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </Suspense>
    </Wrapper>
  );
}
