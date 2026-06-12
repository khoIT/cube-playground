/**
 * Saved analyses tab — list cards backed by segment_analyses rows.
 *
 * Each card is a thin container around the saved Cube query, rendered via the
 * same LineChartCard / BarListCard primitives from P4. v1 surfaces the saved
 * title + query JSON + an "Open in Playground" action.
 *
 * "Open in Playground" opens the saved analysis query scoped to the segment's
 * current uid list by overlaying an IN filter on the identity dimension. This
 * preserves the original behavior: the analysis ran against the query as
 * filtered to the segment's members.
 *
 * The uid overlay uses buildPlaygroundDeeplink / mergeUidFilter. For large
 * uid lists (uid_list.length → URL overflow), the sessionStorage overflow path
 * now has a real consumer in QueryBuilderContainer (?from-segment=), so the
 * old 8000-char limitation is solved rather than sidestepped.
 */

import { ReactElement, useEffect, useState } from 'react';
import { Button, message, Popconfirm } from 'antd';
import { DeleteOutlined, ExportOutlined } from '@ant-design/icons';
import { apiFetch, SegmentApiError } from '../../../../api/api-client';
import type { Segment, SegmentAnalysis } from '../../../../types/segment-api';
import { usePreset } from '../use-preset';
import {
  buildPlaygroundDeeplink,
} from '../../../../utils/playground-deeplink';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
}

export function SavedAnalysesTab({ segment }: Props): ReactElement {
  const [rows, setRows] = useState<SegmentAnalysis[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve the identity dimension for the uid overlay.
  const preset = usePreset(segment);
  const identityDim = preset?.identityDim ?? `${segment.cube ?? ''}.user_id`;

  const load = () => {
    apiFetch<SegmentAnalysis[]>(`/api/segments/${encodeURIComponent(segment.id)}/analyses`)
      .then(setRows)
      .catch((e: SegmentApiError) => setError(e.message));
  };

  useEffect(load, [segment.id]);

  /**
   * Open a saved analysis query in the Playground with the segment's uid list
   * overlaid as an IN filter on the identity dimension.
   *
   * The uid list is the segment's current membership snapshot. For small lists
   * the query is inlined in the URL; for large lists the sessionStorage overflow
   * path handles it (QueryBuilderContainer's ?from-segment= consumer).
   *
   * If the segment has no uid list (predicate-only, no snapshot yet) the query
   * is passed without an overlay — same as opening it standalone.
   */
  const handleOpen = (analysis: SegmentAnalysis) => {
    if (!analysis.query_json) {
      message.warning('This analysis has no saved query.');
      return;
    }

    const uids = segment.uid_list ?? [];

    if (uids.length === 0) {
      // No uid snapshot available — open without overlay.
      const encoded = encodeURIComponent(analysis.query_json);
      window.location.assign(`#/build?query=${encoded}`);
      return;
    }

    let baseQuery: Record<string, unknown>;
    try {
      baseQuery = JSON.parse(analysis.query_json) as Record<string, unknown>;
    } catch {
      message.error('Could not parse the saved query.');
      return;
    }

    const result = buildPlaygroundDeeplink({
      segmentId: segment.id,
      segmentName: segment.name,
      identityDim,
      primaryCube: segment.cube,
      uids,
      baseQuery,
    });

    window.location.assign(result.url);
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
