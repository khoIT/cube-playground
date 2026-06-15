/**
 * Liveops settings tab — exposes the knobs introduced by phases 2, 4, 6:
 *   - KPI strip refresh interval (15–300s)
 *   - Anomaly detector toggle + per-severity z-thresholds
 *   - Per-resource liveops cache TTLs (kpi_strip / cohort_grid / funnel_result)
 *
 * Patches debounce-via-blur (slider commits on release) to avoid hammering
 * /api/settings while dragging.
 */

import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useAppSettings } from './use-app-settings';
import { SectionCard, SectionHead, SectionTitle, SectionHint } from './section-card';

const Row = styled.div`
  display: grid;
  grid-template-columns: 220px 1fr 80px;
  gap: 14px;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid var(--border-card);
`;

const RowLabel = styled.label`
  font-size: 13px;
  color: var(--text-primary);
`;

const NumInput = styled.input`
  width: 76px;
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid var(--border-card);
  border-radius: 4px;
`;

const Range = styled.input`
  width: 100%;
`;

const Checkbox = styled.input`
  margin-right: 6px;
`;

interface ThresholdMap { low: number; med: number; high: number }
interface CacheTtlMap { kpi_strip: number; cohort_grid: number; funnel_result: number }

export function LiveopsSettingsSection() {
  const { settings, loading, error, patch } = useAppSettings();
  const [refreshSec, setRefreshSec] = useState(45);
  const [detectorOn, setDetectorOn] = useState(true);
  const [thresholds, setThresholds] = useState<ThresholdMap>({ low: 2, med: 3, high: 4 });
  const [ttls, setTtls] = useState<CacheTtlMap>({ kpi_strip: 300, cohort_grid: 300, funnel_result: 300 });

  useEffect(() => {
    if (typeof settings['liveops.kpi_refresh_seconds'] === 'number') {
      setRefreshSec(settings['liveops.kpi_refresh_seconds'] as number);
    }
    if (typeof settings['liveops.anomaly_detector_enabled'] === 'boolean') {
      setDetectorOn(settings['liveops.anomaly_detector_enabled'] as boolean);
    }
    if (settings['liveops.anomaly_thresholds']) {
      setThresholds(settings['liveops.anomaly_thresholds'] as ThresholdMap);
    }
    if (settings['liveops.cache_ttl_seconds']) {
      setTtls(settings['liveops.cache_ttl_seconds'] as CacheTtlMap);
    }
  }, [settings]);

  return (
    <SectionCard>
      <SectionHead>
        <div>
          <SectionTitle>Liveops</SectionTitle>
          <SectionHint>Refresh cadence, anomaly detection, cache TTLs.</SectionHint>
        </div>
      </SectionHead>

      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}
      {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}

      <Row>
        <RowLabel>KPI strip refresh (s)</RowLabel>
        <Range
          type="range"
          min={15}
          max={300}
          step={5}
          value={refreshSec}
          onChange={(e) => setRefreshSec(parseInt(e.target.value, 10))}
          onMouseUp={() => patch('liveops.kpi_refresh_seconds', refreshSec)}
          onTouchEnd={() => patch('liveops.kpi_refresh_seconds', refreshSec)}
        />
        <span style={{ textAlign: 'right' }}>{refreshSec}s</span>
      </Row>

      <Row>
        <RowLabel htmlFor="anomaly-toggle">Anomaly detector</RowLabel>
        <div>
          <Checkbox
            id="anomaly-toggle"
            type="checkbox"
            checked={detectorOn}
            onChange={(e) => {
              const next = e.target.checked;
              setDetectorOn(next);
              void patch('liveops.anomaly_detector_enabled', next);
            }}
          />
          {detectorOn ? 'Running' : 'Paused'}
        </div>
        <span />
      </Row>

      {(['low', 'med', 'high'] as const).map((sev) => (
        <Row key={sev}>
          <RowLabel>Threshold |z| ≥ ({sev})</RowLabel>
          <Range
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={thresholds[sev]}
            onChange={(e) => setThresholds({ ...thresholds, [sev]: parseFloat(e.target.value) })}
            onMouseUp={() => patch('liveops.anomaly_thresholds', thresholds)}
            onTouchEnd={() => patch('liveops.anomaly_thresholds', thresholds)}
          />
          <span style={{ textAlign: 'right' }}>{thresholds[sev]}σ</span>
        </Row>
      ))}

      {(['kpi_strip', 'cohort_grid', 'funnel_result'] as const).map((resource) => (
        <Row key={resource}>
          <RowLabel>Cache TTL — {resource} (s)</RowLabel>
          <Range
            type="range"
            min={30}
            max={3600}
            step={30}
            value={ttls[resource]}
            onChange={(e) => setTtls({ ...ttls, [resource]: parseInt(e.target.value, 10) })}
            onMouseUp={() => patch('liveops.cache_ttl_seconds', ttls)}
            onTouchEnd={() => patch('liveops.cache_ttl_seconds', ttls)}
          />
          <NumInput
            type="number"
            min={30}
            max={3600}
            step={30}
            value={ttls[resource]}
            onChange={(e) => setTtls({ ...ttls, [resource]: parseInt(e.target.value, 10) || 0 })}
            onBlur={() => patch('liveops.cache_ttl_seconds', ttls)}
          />
        </Row>
      ))}
    </SectionCard>
  );
}
