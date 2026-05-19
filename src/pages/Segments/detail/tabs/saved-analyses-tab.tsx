/**
 * Saved analyses tab — list cards backed by segment_analyses rows.
 *
 * Each card is a thin container around the saved Cube query, rendered via the
 * same LineChartCard / BarListCard primitives from P4. v1 surfaces the saved
 * title + query JSON + an "Open in Playground" action (uid filter applied).
 */

import { ReactElement, useEffect, useState } from 'react';
import { Button, message, Popconfirm } from 'antd';
import { DeleteOutlined, ExportOutlined } from '@ant-design/icons';
import { apiFetch, SegmentApiError } from '../../../../api/api-client';
import {
  buildPlaygroundDeeplink,
  defaultBaseQuery,
} from '../../../../utils/playground-deeplink';
import type { Segment, SegmentAnalysis } from '../../../../types/segment-api';
import { usePreset } from '../use-preset';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
}

export function SavedAnalysesTab({ segment }: Props): ReactElement {
  const [rows, setRows] = useState<SegmentAnalysis[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preset = usePreset(segment);

  const load = () => {
    apiFetch<SegmentAnalysis[]>(`/api/segments/${encodeURIComponent(segment.id)}/analyses`)
      .then(setRows)
      .catch((e: SegmentApiError) => setError(e.message));
  };

  useEffect(load, [segment.id]);

  const handleOpen = (analysis: SegmentAnalysis) => {
    const baseQuery = analysis.query_json
      ? (JSON.parse(analysis.query_json) as Record<string, unknown>)
      : defaultBaseQuery(segment.cube);
    const identityDim = preset?.identityDim ?? `${segment.cube ?? ''}.user_id`;
    const out = buildPlaygroundDeeplink({
      baseQuery,
      segmentId: segment.id,
      segmentName: segment.name,
      identityDim,
      primaryCube: segment.cube,
      uids: segment.uid_list ?? [],
    });
    window.location.assign(out.url);
  };

  const handleDelete = async (analysis: SegmentAnalysis) => {
    try {
      await apiFetch<void>(
        `/api/segments/${encodeURIComponent(segment.id)}/analyses/${encodeURIComponent(analysis.id)}`,
        { method: 'DELETE' },
      );
      setRows((cur) => (cur ?? []).filter((a) => a.id !== analysis.id));
      message.success('Analysis deleted.');
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  if (error) return <div className={styles.errorState}>{error}</div>;
  if (rows == null) {
    return (
      <div style={{ paddingTop: 16 }}>
        <div className={styles.skeletonRow} style={{ height: 100 }} />
        <div className={styles.skeletonRow} style={{ height: 100 }} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className={styles.tabPending}>
        No analyses yet — pin one from the Playground via{' '}
        <code>Copy as filter</code> + Save Query.
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 16, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
      {rows.map((analysis) => (
        <div
          key={analysis.id}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 10,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{analysis.title}</h3>
            <span style={{ flex: 1 }} />
            <Button size="small" icon={<ExportOutlined />} onClick={() => handleOpen(analysis)}>
              Open in Playground
            </Button>
            <Popconfirm
              title="Delete this analysis?"
              onConfirm={() => handleDelete(analysis)}
              okText="Delete"
              okType="danger"
            >
              <Button size="small" icon={<DeleteOutlined />} danger />
            </Popconfirm>
          </div>
          <pre
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
              maxHeight: 120,
              overflow: 'auto',
            }}
          >
            {analysis.query_json ?? '(no query)'}
          </pre>
        </div>
      ))}
    </div>
  );
}
