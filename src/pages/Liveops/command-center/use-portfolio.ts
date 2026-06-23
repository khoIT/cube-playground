/**
 * usePortfolio — fans out KPI strip + anomaly count fetches across all
 * granted games and assembles one sorted, enriched row per game.
 *
 * Design notes:
 *  - Data source: /api/liveops/kpi-strip (server-cached, sub-100ms per game)
 *    and /api/anomalies?game=<id>&status=open.
 *  - Bounded concurrency: batches of CONCURRENCY_LIMIT games so opening the
 *    portfolio with 20+ titles doesn't simultaneously burst 40+ requests.
 *  - Per-game isolation: Promise.allSettled — one game's failure leaves its
 *    row in error state; the rest of the grid renders normally.
 *  - Revenues computed as fraction of portfolio total for the % column.
 *  - WoW delta comes from the kpi-strip's own `delta` field (server already
 *    computes it; the strip's deltaWindow for revenue/paying is '1d', for dau
 *    is '1d'. We surface the revenue delta as the headline trend signal).
 */

import { useEffect, useState } from 'react';
import type { GameDef } from '../../../types/segment-api';

const CONCURRENCY_LIMIT = 5;
const REFRESH_INTERVAL_MS = 60_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PortfolioRow {
  game: GameDef;
  /** Latest DAU (last day in the strip). */
  dau: number | null;
  /** Last-window total revenue VND. */
  revenue: number | null;
  /** Last-window paying users. */
  paying: number | null;
  /** Latest ARPDAU. */
  arpdau: number | null;
  /** Revenue WoW delta fraction (null = unavailable). Comes from kpi-strip's delta. */
  revDelta: number | null;
  /** DAU WoW delta fraction (null = unavailable). */
  dauDelta: number | null;
  /** Fraction of total portfolio revenue (0–1). */
  revShare: number | null;
  /** Open anomaly count for health flag. */
  openAnomalies: number;
  /** Revenue rank (1 = highest). */
  revRank: number;
  loading: boolean;
  error: string | null;
}

interface KpiTileRaw {
  id: string;
  latest: number | null;
  delta: number | null;
  unavailable: boolean;
}

interface KpiStripResponse {
  payload?: { tiles?: KpiTileRaw[] };
  status?: string;
}

interface AnomalyResponse {
  anomalies?: Array<{ id: number; status: string }>;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchKpiStrip(gameId: string): Promise<KpiTileRaw[]> {
  const res = await fetch(
    `/api/liveops/kpi-strip?game=${encodeURIComponent(gameId)}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as KpiStripResponse;
  return json.payload?.tiles ?? [];
}

async function fetchOpenAnomalies(gameId: string): Promise<number> {
  const res = await fetch(
    `/api/anomalies?game=${encodeURIComponent(gameId)}&status=open`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return 0; // non-fatal: anomaly count defaults to 0 on error
  const json = (await res.json()) as AnomalyResponse;
  return json.anomalies?.length ?? 0;
}

function tileValue(tiles: KpiTileRaw[], id: string): number | null {
  const t = tiles.find((t) => t.id === id);
  if (!t || t.unavailable || t.latest == null) return null;
  return t.latest;
}

function tileDelta(tiles: KpiTileRaw[], id: string): number | null {
  const t = tiles.find((t) => t.id === id);
  if (!t || t.unavailable || t.delta == null) return null;
  return t.delta;
}

// ── Bounded fan-out ───────────────────────────────────────────────────────────

async function fetchGameRow(
  game: GameDef,
): Promise<{ tiles: KpiTileRaw[]; anomalies: number }> {
  // Fire both in parallel per game — they're cached, fast.
  const [tiles, anomalies] = await Promise.all([
    fetchKpiStrip(game.id),
    fetchOpenAnomalies(game.id),
  ]);
  return { tiles, anomalies };
}

async function fetchAllGames(
  games: GameDef[],
  signal: AbortSignal,
): Promise<Array<{ game: GameDef; tiles: KpiTileRaw[]; anomalies: number; error: string | null }>> {
  const results: Array<{ game: GameDef; tiles: KpiTileRaw[]; anomalies: number; error: string | null }> = [];

  // Process in batches to cap concurrent connections.
  for (let i = 0; i < games.length; i += CONCURRENCY_LIMIT) {
    if (signal.aborted) break;
    const batch = games.slice(i, i + CONCURRENCY_LIMIT);
    const settled = await Promise.allSettled(batch.map((g) => fetchGameRow(g)));
    for (let j = 0; j < batch.length; j++) {
      const s = settled[j];
      if (s.status === 'fulfilled') {
        results.push({ game: batch[j], ...s.value, error: null });
      } else {
        results.push({ game: batch[j], tiles: [], anomalies: 0, error: (s.reason as Error).message });
      }
    }
  }
  return results;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UsePortfolioResult {
  rows: PortfolioRow[];
  loading: boolean;
  totalRevenue: number;
}

export function usePortfolio(games: GameDef[]): UsePortfolioResult {
  const [rows, setRows] = useState<PortfolioRow[]>(() =>
    games.map((g) => ({
      game: g,
      dau: null,
      revenue: null,
      paying: null,
      arpdau: null,
      revDelta: null,
      dauDelta: null,
      revShare: null,
      openAnomalies: 0,
      revRank: 0,
      loading: true,
      error: null,
    })),
  );
  const [loading, setLoading] = useState(true);

  const gameIds = games.map((g) => g.id).join(',');

  useEffect(() => {
    if (games.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    // Reset to skeletons on games list change.
    setRows(
      games.map((g) => ({
        game: g,
        dau: null,
        revenue: null,
        paying: null,
        arpdau: null,
        revDelta: null,
        dauDelta: null,
        revShare: null,
        openAnomalies: 0,
        revRank: 0,
        loading: true,
        error: null,
      })),
    );
    setLoading(true);

    const controller = new AbortController();

    const run = async () => {
      const raw = await fetchAllGames(games, controller.signal);
      if (controller.signal.aborted) return;

      // Compute portfolio revenue total for % share.
      const totalRev = raw.reduce((sum, r) => {
        const v = tileValue(r.tiles, 'revenue');
        return sum + (v ?? 0);
      }, 0);

      // Sort by revenue descending for rank.
      const sorted = [...raw].sort((a, b) => {
        const ra = tileValue(a.tiles, 'revenue') ?? 0;
        const rb = tileValue(b.tiles, 'revenue') ?? 0;
        return rb - ra;
      });

      const rankMap = new Map<string, number>();
      sorted.forEach((r, idx) => rankMap.set(r.game.id, idx + 1));

      const built: PortfolioRow[] = raw.map((r) => {
        const rev = tileValue(r.tiles, 'revenue');
        return {
          game: r.game,
          dau: tileValue(r.tiles, 'dau'),
          revenue: rev,
          paying: tileValue(r.tiles, 'paying'),
          arpdau: tileValue(r.tiles, 'arpdau'),
          revDelta: tileDelta(r.tiles, 'revenue'),
          dauDelta: tileDelta(r.tiles, 'dau'),
          revShare: totalRev > 0 && rev != null ? rev / totalRev : null,
          openAnomalies: r.anomalies,
          revRank: rankMap.get(r.game.id) ?? 0,
          loading: false,
          error: r.error,
        };
      });

      setRows(built);
      setLoading(false);
    };

    void run().catch((err) => {
      if (!controller.signal.aborted) {
        // Mark all rows as errored
        setRows((prev) =>
          prev.map((r) => ({ ...r, loading: false, error: (err as Error).message })),
        );
        setLoading(false);
      }
    });

    const interval = setInterval(() => {
      if (!document.hidden) void run();
    }, REFRESH_INTERVAL_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameIds]);

  const totalRevenue = rows.reduce((s, r) => s + (r.revenue ?? 0), 0);

  return { rows, loading, totalRevenue };
}
