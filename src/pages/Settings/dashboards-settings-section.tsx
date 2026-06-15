/**
 * Dashboards settings tab — global defaults for tile refresh + starter pack
 * actions. Per-dashboard TTL overrides remain editable in dashboard settings.
 */

import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useAppSettings } from './use-app-settings';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { dashboardsClient } from '../../api/dashboards-client';
import { SectionCard, SectionHead, SectionTitle, SectionHint } from './section-card';

const Row = styled.div`
  display: grid;
  grid-template-columns: 240px 1fr 80px;
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

const ResetBtn = styled.button`
  margin-top: 16px;
  height: 32px;
  padding: 0 16px;
  background: var(--brand-soft);
  border: 1px solid var(--brand);
  border-radius: 6px;
  color: var(--brand);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

export function DashboardsSettingsSection() {
  const { settings, loading, error, patch } = useAppSettings();
  const gameId = useActiveGameId();

  const [tileTtl, setTileTtl] = useState(300);
  const [horizon, setHorizon] = useState(7);
  const [concurrency, setConcurrency] = useState(30);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof settings['dashboards.tile_ttl_seconds'] === 'number') {
      setTileTtl(settings['dashboards.tile_ttl_seconds'] as number);
    }
    if (typeof settings['dashboards.refresh_horizon_days'] === 'number') {
      setHorizon(settings['dashboards.refresh_horizon_days'] as number);
    }
    if (typeof settings['dashboards.refresh_concurrency'] === 'number') {
      setConcurrency(settings['dashboards.refresh_concurrency'] as number);
    }
  }, [settings]);

  async function handleReset() {
    setResetting(true);
    setResetMsg(null);
    try {
      const res = await dashboardsClient.resetStarterPack(gameId);
      setResetMsg(
        res.inserted.length > 0
          ? `Inserted: ${res.inserted.join(', ')}`
          : 'No starters needed installing — all up to date.',
      );
    } catch (err) {
      setResetMsg(`Failed: ${(err as Error).message}`);
    } finally {
      setResetting(false);
    }
  }

  return (
    <SectionCard>
      <SectionHead>
        <div>
          <SectionTitle>Dashboards</SectionTitle>
          <SectionHint>Tile cache TTL, refresh horizon, and starter-pack actions.</SectionHint>
        </div>
      </SectionHead>

      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}
      {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}

      <Row>
        <RowLabel>Default tile TTL (s)</RowLabel>
        <Range
          type="range"
          min={30}
          max={3600}
          step={30}
          value={tileTtl}
          onChange={(e) => setTileTtl(parseInt(e.target.value, 10))}
          onMouseUp={() => patch('dashboards.tile_ttl_seconds', tileTtl)}
          onTouchEnd={() => patch('dashboards.tile_ttl_seconds', tileTtl)}
        />
        <NumInput
          type="number"
          min={30}
          max={3600}
          step={30}
          value={tileTtl}
          onChange={(e) => setTileTtl(parseInt(e.target.value, 10) || 0)}
          onBlur={() => patch('dashboards.tile_ttl_seconds', tileTtl)}
        />
      </Row>

      <Row>
        <RowLabel>Refresh horizon (days)</RowLabel>
        <Range
          type="range"
          min={1}
          max={90}
          step={1}
          value={horizon}
          onChange={(e) => setHorizon(parseInt(e.target.value, 10))}
          onMouseUp={() => patch('dashboards.refresh_horizon_days', horizon)}
          onTouchEnd={() => patch('dashboards.refresh_horizon_days', horizon)}
        />
        <span style={{ textAlign: 'right' }}>{horizon}d</span>
      </Row>

      <Row>
        <RowLabel>Tile refresh concurrency</RowLabel>
        <Range
          type="range"
          min={1}
          max={100}
          step={1}
          value={concurrency}
          onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
          onMouseUp={() => patch('dashboards.refresh_concurrency', concurrency)}
          onTouchEnd={() => patch('dashboards.refresh_concurrency', concurrency)}
        />
        <span style={{ textAlign: 'right' }}>{concurrency}</span>
      </Row>

      <div style={{ marginTop: 24 }}>
        <SectionTitle as="h3" style={{ fontSize: 14 }}>
          Starter pack for "{gameId}"
        </SectionTitle>
        <SectionHint>
          Re-installs any starter dashboards that aren't present. User-created dashboards are untouched.
        </SectionHint>
        <ResetBtn type="button" onClick={handleReset} disabled={resetting}>
          {resetting ? 'Re-seeding…' : 'Reset starter pack for this game'}
        </ResetBtn>
        {resetMsg && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>{resetMsg}</div>
        )}
      </div>
    </SectionCard>
  );
}
