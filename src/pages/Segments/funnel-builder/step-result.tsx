/**
 * Step 3 — Result view.
 *
 * Runs runFunnel on mount (and whenever inputs change via the Re-run button).
 * Renders:
 *   - Detection badge (Ordered · single query)
 *   - <FunnelBarList> — step counts + drop-off % annotations
 *   - <LineChart>    — cumulative step-1 completion percentage over time
 *     (uses step counts as a proxy trend when no time-series data available)
 *   - Save-as-Segment form (name input + POST)
 */

import { ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Button } from 'antd';
import { useAppContext } from '../../../hooks';
import { useSecurityContext } from '../../../hooks/security-context';
import { useCubejsApi } from '../../../hooks/cubejs-api';
import { useActiveGameId, useGameContext } from '../../../components/Header/use-game-context';
import { segmentsClient } from '../../../api/segments-client';
import { LineChart } from '../visuals/line-chart';
import { FunnelBarList } from './funnel-bar-list';
import { runFunnel, type FunnelResult, type CubejsLikeApi } from './run-funnel';
import type { FunnelDefinition } from './index';
import { CrossGameCompare } from './cross-game-compare';
import styles from './funnel-builder.module.css';

interface Props {
  cubeName: string;
  definition: FunnelDefinition;
}

export function StepResult({ cubeName, definition }: Props): ReactElement {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();
  const cubejsApi = useCubejsApi(apiUrl ?? null, currentToken ?? null);
  const gameId = useActiveGameId();
  const { games } = useGameContext();
  const history = useHistory();

  const [result, setResult] = useState<FunnelResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Save state
  const [saveName, setSaveName] = useState(
    () => `Funnel: ${definition.orderedEvents.slice(0, 2).join(' → ')}`,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const runRef = useRef(0);

  const execute = useCallback(async () => {
    if (!cubejsApi) return;
    const runId = ++runRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await runFunnel({
        orderedEvents: definition.orderedEvents,
        windowMs: definition.windowMs,
        cubeName,
        cubejsApi: cubejsApi as unknown as CubejsLikeApi,
      });
      if (runRef.current === runId) setResult(res);
    } catch (err) {
      if (runRef.current === runId) setError((err as Error).message);
    } finally {
      if (runRef.current === runId) setLoading(false);
    }
  }, [cubejsApi, cubeName, definition]);

  // Auto-run on mount
  useEffect(() => { void execute(); }, [execute]);

  const handleSave = async () => {
    if (!result || !saveName.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const seg = await segmentsClient.create({
        name: saveName.trim(),
        type: 'manual',
        game_id: gameId ?? undefined,
        funnel_json: JSON.stringify(definition),
      } as Parameters<typeof segmentsClient.create>[0]);
      history.push(`/segments/${seg.id}`);
    } catch (err) {
      setSaveError((err as Error).message);
      setSaving(false);
    }
  };

  // Build a simple trend line from step counts (index = step position)
  const trendData = result
    ? result.steps.map((s, i) => ({
        x: `Step ${i + 1}`,
        y: s.count,
      }))
    : [];

  return (
    <div className={styles.card}>
      <div className={styles.wizardHeader} style={{ marginBottom: 0 }}>
        <h3 className={styles.cardTitle} style={{ flex: 1 }}>Funnel results</h3>
        <span className={`${styles.detectionBadge} ${styles.detectionBadgeOrdered}`}>
          Ordered · single query
        </span>
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

      {loading && !result && (
        <p className={styles.cardDesc}>Running funnel query…</p>
      )}

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

          {/* Phase 4.2 — cross-game compare */}
          <CrossGameCompare
            cubeName={cubeName}
            baseGameId={gameId}
            candidateGames={games}
            orderedEvents={definition.orderedEvents}
            windowMs={definition.windowMs}
            baseSteps={result.steps}
          />

          {/* Save as segment */}
          <div className={styles.resultSection}>
            <p className={styles.resultSectionTitle}>Save as segment</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                className={styles.typeaheadInput}
                style={{ flex: 1 }}
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Segment name…"
                aria-label="Segment name"
              />
              <Button
                type="primary"
                size="small"
                onClick={() => void handleSave()}
                loading={saving}
                disabled={!saveName.trim() || saving}
              >
                Save segment
              </Button>
            </div>
            {saveError && (
              <p className={styles.validationMsg} role="alert">{saveError}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
