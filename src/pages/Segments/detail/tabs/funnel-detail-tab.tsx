/**
 * Funnel detail tab — shown on saved funnel segments (funnel_json != null).
 *
 * Re-runs runFunnel against the ordered-funnel cube on each open.
 * Renders FunnelBarList + LineChart, identical to the wizard Step 3 result,
 * but in a read-only view inside the segment detail layout.
 */

import { ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { useAppContext } from '../../../../hooks';
import { useSecurityContext } from '../../../../hooks/security-context';
import { useCubejsApi } from '../../../../hooks/cubejs-api';
import { useFunnelDetection } from '../../funnel-builder/use-funnel-detection';
import { FunnelBarList } from '../../funnel-builder/funnel-bar-list';
import { runFunnel, type FunnelResult, type CubejsLikeApi } from '../../funnel-builder/run-funnel';
import { LineChart } from '../../visuals/line-chart';
import type { FunnelDefinition } from '../../funnel-builder/index';
import styles from '../../funnel-builder/funnel-builder.module.css';

interface Props {
  funnelJson: string;
}

export function FunnelDetailTab({ funnelJson }: Props): ReactElement {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();
  const cubejsApi = useCubejsApi(apiUrl ?? null, currentToken ?? null);
  const detection = useFunnelDetection();

  const [result, setResult] = useState<FunnelResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runRef = useRef(0);

  // Parse the stored definition; bail out gracefully on malformed JSON.
  let definition: FunnelDefinition | null = null;
  try {
    definition = JSON.parse(funnelJson) as FunnelDefinition;
  } catch {
    return (
      <div className={styles.errorBanner} role="alert">
        Funnel definition is corrupted and cannot be displayed.
      </div>
    );
  }

  const execute = useCallback(async () => {
    if (!cubejsApi || detection.status !== 'found' || !definition) return;
    const runId = ++runRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await runFunnel({
        orderedEvents: definition.orderedEvents,
        windowMs: definition.windowMs,
        cubeName: detection.cubeName,
        cubejsApi: cubejsApi as unknown as CubejsLikeApi,
      });
      if (runRef.current === runId) setResult(res);
    } catch (err) {
      if (runRef.current === runId) setError((err as Error).message);
    } finally {
      if (runRef.current === runId) setLoading(false);
    }
  // definition is re-parsed each render; stable via funnelJson dependency
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cubejsApi, detection, funnelJson]);

  useEffect(() => { void execute(); }, [execute]);

  const trendData = result
    ? result.steps.map((s, i) => ({ x: `Step ${i + 1}`, y: s.count }))
    : [];

  if (detection.status === 'loading') {
    return <p className={styles.cardDesc}>Detecting funnel cube…</p>;
  }

  if (detection.status === 'absent') {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyStateIcon} aria-hidden>⚗️</span>
        <h3 className={styles.emptyStateTitle}>Ordered funnel cube not found</h3>
        <p className={styles.emptyStateBody}>
          Deploy the <code>ordered_event_funnel</code> cube (see{' '}
          <code>docs/ordered-funnel-cube-template.md</code>) to re-run this funnel.
        </p>
      </div>
    );
  }

  if (detection.status === 'error') {
    return (
      <div className={styles.errorBanner} role="alert">
        <strong>Cube connection error:</strong>&nbsp;{detection.message}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '20px 0' }}>
      <div className={styles.wizardHeader}>
        <span className={`${styles.detectionBadge} ${styles.detectionBadgeOrdered}`}>
          Ordered · single query
        </span>
        <span style={{ flex: 1 }} />
        <Button size="small" onClick={() => void execute()} disabled={loading}>
          {loading ? (
            <><span className={styles.runSpinner} aria-hidden />Running…</>
          ) : 'Re-run'}
        </Button>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <strong>Error:</strong>&nbsp;{error}
        </div>
      )}

      {loading && !result && <p className={styles.cardDesc}>Running funnel query…</p>}

      {result && (
        <>
          <div className={styles.resultSection}>
            <p className={styles.resultSectionTitle}>Drop-off by step</p>
            <FunnelBarList steps={result.steps} />
          </div>
          <div className={styles.resultSection}>
            <p className={styles.resultSectionTitle}>Users per step</p>
            <LineChart data={trendData} height={140} areaFill />
          </div>
        </>
      )}
    </div>
  );
}
