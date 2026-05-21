/**
 * Activate-to-CDP tab body. Surfaces derived metric_name, source, dimensions,
 * env radio, optional materialize cron, plus an Advanced fold showing the
 * server-derived SQL filter. Submit chains MM-01 createMetric → activations
 * POST → optimistic UI update.
 */

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { Input, Radio, Select, Checkbox, Button, Alert, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { segmentsClient } from '../../../../api/segments-client';
import { cdpMetricsClient } from '../../../../api/cdp-metrics-client';
import { deriveMetricName } from '../derive-metric-name';
import { deriveSource } from '../derive-source';
import type { Segment, ActivationEnv, Activation } from '../../../../types/segment-api';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
  identityField: string | null;
  dimensionOptions?: string[];
  onClose: () => void;
  onActivated?: (updated: Segment) => void;
}

const ENV_VALUES: ActivationEnv[] = ['dev', 'stag', 'prod'];
const METRIC_RE = /^[a-z0-9_]{1,64}$/;

export function ActivateToCdpTab({
  segment,
  identityField,
  dimensionOptions = ['server_id', 'platform'],
  onClose,
  onActivated,
}: Props): ReactElement {
  const { t } = useTranslation();
  const [metricName, setMetricName] = useState(deriveMetricName(segment.name));
  const [env, setEnv] = useState<ActivationEnv>('prod');
  const [dimensions, setDimensions] = useState<string[]>(dimensionOptions.slice(0, 2));
  const [materialize, setMaterialize] = useState(false);
  const [cron, setCron] = useState('0 */6 * * *');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sqlFilter, setSqlFilter] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const mockMode = cdpMetricsClient.isMockMode();

  const source = useMemo(
    () => deriveSource(segment.game_id, segment.cube),
    [segment.game_id, segment.cube],
  );
  const expression = identityField
    ? `COUNT(DISTINCT ${identityField})`
    : 'COUNT(DISTINCT user_id)';

  useEffect(() => {
    let cancelled = false;
    segmentsClient
      .sqlFilter(segment.id)
      .then((res) => {
        if (!cancelled) setSqlFilter(res.filter);
      })
      .catch(() => {
        if (!cancelled) setSqlFilter('1=1');
      });
    return () => {
      cancelled = true;
    };
  }, [segment.id]);

  const valid = METRIC_RE.test(metricName) && ENV_VALUES.includes(env);

  const handleSubmit = async () => {
    if (!valid) {
      message.error(t('segments.activate.invalid', { defaultValue: 'Fix the form before submitting.' }));
      return;
    }
    setSubmitting(true);
    try {
      const created = await cdpMetricsClient.createMetric({
        metric_name: metricName,
        expression,
        filter: sqlFilter,
        source,
        dimensions,
        env,
        game_id: segment.game_id,
        materialize: materialize ? { cron } : undefined,
      });
      const updated = await segmentsClient.appendActivation(segment.id, {
        env,
        metric_name: metricName,
        game_id: segment.game_id,
        status: created.status === 'failed' ? 'failed' : 'active',
      });
      onActivated?.(updated);
      message.success(
        t('segments.activate.success', {
          defaultValue: 'Activated to CDP · {{env}}',
          env,
        }),
      );
      onClose();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.activateTabBody}>
      <div className={styles.activateSummary}>
        <strong>{segment.name}</strong>
        <span>
          · {segment.uid_count} {t('segments.activate.users', { defaultValue: 'users' })}
        </span>
        {segment.cube && <span> · cube {segment.cube}</span>}
        {identityField && <span> · identity {identityField}</span>}
      </div>

      {mockMode && (
        <Alert
          type="info"
          showIcon
          message={t('segments.activate.mockBanner', {
            defaultValue: 'CDP wiring is in mock mode — submissions are simulated.',
          })}
        />
      )}

      <div className={styles.activateField}>
        <label htmlFor="activate-metric-name">
          {t('segments.activate.metricName', { defaultValue: 'Metric name' })}
        </label>
        <Input
          id="activate-metric-name"
          value={metricName}
          onChange={(e) => setMetricName(e.target.value.trim().toLowerCase())}
          status={METRIC_RE.test(metricName) ? undefined : 'error'}
        />
        <p className={styles.activateHint}>
          {t('segments.activate.metricNameHint', {
            defaultValue: 'Lowercase a-z 0-9 _, ≤ 64 chars.',
          })}
        </p>
      </div>

      <div className={styles.activateField}>
        <label>{t('segments.activate.env', { defaultValue: 'Environment' })}</label>
        <Radio.Group value={env} onChange={(e) => setEnv(e.target.value as ActivationEnv)}>
          {ENV_VALUES.map((v) => (
            <Radio.Button key={v} value={v}>{v}</Radio.Button>
          ))}
        </Radio.Group>
      </div>

      <div className={styles.activateField}>
        <label>{t('segments.activate.dimensions', { defaultValue: 'Dimensions' })}</label>
        <Select
          mode="tags"
          style={{ width: '100%' }}
          value={dimensions}
          onChange={setDimensions}
          options={dimensionOptions.map((d) => ({ value: d, label: d }))}
        />
      </div>

      <div className={styles.activateField}>
        <Checkbox checked={materialize} onChange={(e) => setMaterialize(e.target.checked)}>
          {t('segments.activate.materialize', { defaultValue: 'Materialize on schedule' })}
        </Checkbox>
        {materialize && (
          <Input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 */6 * * *"
            style={{ marginTop: 8, fontFamily: 'var(--font-mono)' }}
          />
        )}
      </div>

      <div>
        <button
          type="button"
          className={styles.activateAdvancedToggle}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen
            ? t('segments.activate.advanced.hide', { defaultValue: 'Hide advanced' })
            : t('segments.activate.advanced.show', { defaultValue: 'Show advanced' })}
        </button>
        {advancedOpen && (
          <dl className={styles.activateAdvanced}>
            <div>
              <dt>expression</dt>
              <dd>{expression}</dd>
            </div>
            <div>
              <dt>filter</dt>
              <dd>{sqlFilter || '—'}</dd>
            </div>
            <div>
              <dt>source</dt>
              <dd>{source}</dd>
            </div>
          </dl>
        )}
      </div>

      <footer className={styles.activateFooter}>
        <Button onClick={onClose}>
          {t('segments.activate.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button type="primary" loading={submitting} disabled={!valid} onClick={handleSubmit}>
          {t('segments.activate.submit', { defaultValue: 'Activate' })}
        </Button>
      </footer>
    </div>
  );
}

export type { Activation };
