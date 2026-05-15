import { Alert, Table } from 'antd';
import { Flow, Paragraph } from '@cube-dev/ui-kit';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { FunnelStepResult } from './use-funnel-queries';

const STEP_COLORS = ['#7A77FF', '#8C87FF', '#9F98FF', '#B2A9FF', '#C5BAFF', '#D8CCFF', '#EBDDFF'];

interface FunnelResultsProps {
  isLoading: boolean;
  error: string | null;
  failedStepIndex: number | null;
  results: FunnelStepResult[];
}

export function FunnelResults({ isLoading, error, failedStepIndex, results }: FunnelResultsProps) {
  if (error) {
    return (
      <Alert
        type="error"
        message={`Step ${failedStepIndex != null ? failedStepIndex + 1 : '?'} query failed`}
        description={error}
      />
    );
  }

  if (isLoading && results.length === 0) {
    return <Paragraph color="#dark-03">Running parallel queries…</Paragraph>;
  }

  const chartData = results.map((r) => ({ name: r.label, count: r.count }));

  return (
    <Flow gap="1x">
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={56} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count">
              {chartData.map((_, idx) => (
                <Cell key={idx} fill={STEP_COLORS[idx % STEP_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Table
        size="small"
        rowKey="step"
        pagination={false}
        dataSource={results}
        columns={[
          { title: '#', dataIndex: 'step', key: 'step', width: 48 },
          { title: 'Step', dataIndex: 'label', key: 'label' },
          {
            title: 'Count',
            dataIndex: 'count',
            key: 'count',
            render: (v: number) => v.toLocaleString(),
          },
          {
            title: '% of step 1',
            dataIndex: 'conversionPct',
            key: 'conversionPct',
            render: (v: number) => `${v.toFixed(1)}%`,
          },
          {
            title: 'Drop-off vs previous',
            dataIndex: 'dropOffPct',
            key: 'dropOffPct',
            render: (v: number, _row, idx) => (idx === 0 ? '—' : `${v.toFixed(1)}%`),
          },
        ]}
      />
    </Flow>
  );
}
