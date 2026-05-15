import { useMemo, useState } from 'react';
import { Table } from 'antd';
import { Flow, Paragraph, Title } from '@cube-dev/ui-kit';

import { useQueryBuilderContext } from '../context';

import { EmptyState } from './empty-state';
import { detectBreakdownInputs, detectSampleCube } from './sample-detector';

type SortDir = 'ascend' | 'descend' | null;

interface SortState {
  field: string;
  order: SortDir;
}

function shortName(name: string): string {
  const parts = name.split('.');

  return parts[parts.length - 1] || name;
}

export function BreakdownMode() {
  const { query, resultSet, isLoading, meta, usedCubes, updateQuery, runQuery } =
    useQueryBuilderContext();
  const dimensions = query.dimensions || [];
  const measures = query.measures || [];
  const primaryMeasure = measures[0];

  const sampleCube = useMemo(() => detectSampleCube(meta, usedCubes), [meta, usedCubes]);
  const sample = useMemo(() => detectBreakdownInputs(sampleCube), [sampleCube]);

  const handleTrySample = () => {
    if (!sample) return;
    updateQuery({ dimensions: sample.dimensions, measures: sample.measures });
    setTimeout(() => runQuery?.(), 0);
  };

  const [sort, setSort] = useState<SortState | null>(null);

  const rows = useMemo(() => {
    try {
      return resultSet?.tablePivot?.() ?? [];
    } catch {
      return [];
    }
  }, [resultSet]);

  const isConfigured = dimensions.length > 0 && !!primaryMeasure;

  if (!isConfigured) {
    return (
      <EmptyState
        title="Breakdown"
        description="Rank combinations of dimensions by a measure. Pick from the pill bar above, or load a sample."
        helpBullets={[
          'Pick ≥1 dimension and 1 measure in the pill bar.',
          'Rows are sorted by the first measure descending.',
          'Click any column header to flip sort order.',
        ]}
        onTrySample={handleTrySample}
        canTrySample={!!sample}
        disabledReason="No suitable cube found in the current schema."
      />
    );
  }

  const activeField = sort?.field ?? primaryMeasure;
  const activeOrder: SortDir = sort?.order ?? 'descend';

  const sortedRows = useMemo(() => {
    if (!activeField || !activeOrder) {
      return rows;
    }

    const direction = activeOrder === 'ascend' ? 1 : -1;
    const copy = [...rows];

    copy.sort((a: any, b: any) => {
      const av = a?.[activeField];
      const bv = b?.[activeField];

      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * direction;
      }

      return String(av).localeCompare(String(bv)) * direction;
    });

    return copy;
  }, [rows, activeField, activeOrder]);

  const columns = [
    ...dimensions.map((dim) => ({
      title: shortName(dim),
      dataIndex: dim,
      key: dim,
      sorter: true,
      sortOrder: activeField === dim ? activeOrder : null,
      render: (value: unknown) => (value == null ? '—' : String(value)),
    })),
    {
      title: shortName(primaryMeasure),
      dataIndex: primaryMeasure,
      key: primaryMeasure,
      sorter: true,
      sortOrder: activeField === primaryMeasure ? activeOrder : null,
      render: (value: unknown) => (typeof value === 'number' ? value.toLocaleString() : value),
    },
  ];

  const dimLabel = dimensions.map(shortName).join(', ');
  const measureLabel = shortName(primaryMeasure);

  return (
    <Flow gap="1x">
      <Title level={5} preset="t3">
        Breakdown of <b>{measureLabel}</b> by <b>{dimLabel}</b>
      </Title>
      <Table
        size="small"
        rowKey={(record: any, idx) =>
          [...dimensions.map((d) => record?.[d]), idx].join('|')
        }
        loading={isLoading}
        dataSource={sortedRows}
        columns={columns as any}
        pagination={{ pageSize: 50, showSizeChanger: false, size: 'small' }}
        onChange={(_pagination, _filters, sorter: any) => {
          if (sorter && sorter.field) {
            setSort({ field: sorter.field, order: sorter.order ?? null });
          }
        }}
      />
      <Paragraph color="#dark-03">
        {rows.length === 0
          ? 'No rows. Run the query in the pill bar to populate.'
          : `${rows.length.toLocaleString()} row${rows.length === 1 ? '' : 's'} · sorted by ${shortName(activeField)} ${activeOrder === 'ascend' ? '↑' : '↓'}.`}
      </Paragraph>
    </Flow>
  );
}
