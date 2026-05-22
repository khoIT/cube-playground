import { useMemo, useState } from 'react';
import { Select, Table } from 'antd';
import { Flow, Paragraph, Title, tasty } from '@cube-dev/ui-kit';

import { useQueryBuilderContext } from '../context';
import { formatShare, sumMeasure } from '../utils/share-of-total';

type SortDir = 'ascend' | 'descend' | null;

interface SortState {
  field: string;
  order: SortDir;
}

function shortName(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1] || name;
}

const PickerRow = tasty({
  styles: {
    display: 'grid',
    gridColumns: '1fr 1fr',
    gap: '1x',
    placeItems: 'end stretch',
  },
});

export function BreakdownMode() {
  const { query, resultSet, isLoading, joinableMembers, updateQuery, runQuery } =
    useQueryBuilderContext();
  const dimensions = query.dimensions || [];
  const measures = query.measures || [];
  const primaryDim = dimensions[0];
  const primaryMeasure = measures[0];

  const dimOptions = useMemo(
    () =>
      Object.values(joinableMembers.dimensions).filter(
        (d: any) => d?.type === 'string' || d?.type === 'number'
      ) as any[],
    [joinableMembers]
  );
  const measureOptions = useMemo(
    () => Object.values(joinableMembers.measures) as any[],
    [joinableMembers]
  );

  // Auto-apply: editing a Select rewrites the query so the breakdown
  // refreshes immediately. The pill bar above still mirrors the same state.
  const applyChange = (next: { dim?: string; measure?: string }) => {
    updateQuery({
      dimensions: next.dim ? [next.dim] : dimensions,
      measures: next.measure ? [next.measure] : measures,
    });
    setTimeout(() => runQuery?.(), 0);
  };

  const [sort, setSort] = useState<SortState | null>(null);

  // Prefer `rawData()` over `tablePivot()`: rawData guarantees flat rows with
  // full-dotted member names as keys (e.g. `recharge.payment_channel`), while
  // tablePivot can reshape keys depending on the inferred pivot config.
  const rows = useMemo(() => {
    try {
      return resultSet?.rawData?.() ?? [];
    } catch {
      return [];
    }
  }, [resultSet]);

  const total = useMemo(
    () => (primaryMeasure ? sumMeasure(rows as any, primaryMeasure) : 0),
    [rows, primaryMeasure]
  );

  const picker = (
    <PickerRow>
      <Flow>
        <Paragraph preset="c1m">Dimension</Paragraph>
        <Select
          showSearch
          placeholder="Pick a dimension"
          style={{ width: '100%' }}
          value={primaryDim}
          options={dimOptions.map((d) => ({ value: d.name, label: shortName(d.name) }))}
          onChange={(v) => applyChange({ dim: v })}
        />
      </Flow>
      <Flow>
        <Paragraph preset="c1m">Measure</Paragraph>
        <Select
          showSearch
          placeholder="Pick a measure"
          style={{ width: '100%' }}
          value={primaryMeasure}
          options={measureOptions.map((m) => ({ value: m.name, label: shortName(m.name) }))}
          onChange={(v) => applyChange({ measure: v })}
        />
      </Flow>
    </PickerRow>
  );

  const isConfigured = !!primaryDim && !!primaryMeasure;

  if (!isConfigured) {
    return (
      <Flow gap="1x">
        <Title level={5} preset="t3">
          Breakdown
        </Title>
        <Paragraph color="#dark-03">
          {primaryDim
            ? 'Pick a measure to rank rows.'
            : primaryMeasure
            ? 'Pick a dimension to break down by.'
            : 'Pick a dimension and a measure to populate the breakdown.'}
        </Paragraph>
        {picker}
      </Flow>
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

  // Note: antd v4 splits a dotted `dataIndex` string into a nested path,
  // which breaks for Cube member names like `recharge.payment_channel`.
  // We bypass `dataIndex` and read flat keys via `render(_, record)`.
  const columns = [
    ...dimensions.map((dim) => ({
      title: shortName(dim),
      key: dim,
      sorter: true,
      sortOrder: activeField === dim ? activeOrder : null,
      render: (_value: unknown, record: any) => {
        const v = record?.[dim];
        return v == null || v === '' ? '—' : String(v);
      },
    })),
    {
      title: shortName(primaryMeasure),
      key: primaryMeasure,
      sorter: true,
      sortOrder: activeField === primaryMeasure ? activeOrder : null,
      align: 'right' as const,
      render: (_value: unknown, record: any) => {
        const v = record?.[primaryMeasure];
        if (v == null) return '—';
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n.toLocaleString() : String(v);
      },
    },
    {
      title: '% of total',
      key: '__pct__',
      align: 'right' as const,
      render: (_value: unknown, record: any) =>
        formatShare(record?.[primaryMeasure], total),
    },
  ];

  const dimLabel = dimensions.map(shortName).join(', ');
  const measureLabel = shortName(primaryMeasure);

  return (
    <Flow gap="1x">
      <Title level={5} preset="t3">
        Breakdown of <b>{measureLabel}</b> by <b>{dimLabel}</b>
      </Title>
      {picker}
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
