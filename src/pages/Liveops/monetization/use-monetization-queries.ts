/**
 * Data-fetching hooks for the Monetization deep-dive page.
 *
 * Three server-side endpoints (aggregate-only, no PII):
 *  - /api/monetization/payer-tiers   — tier distribution + Gini
 *  - /api/monetization/cohort-ltv    — realized LTV by install-month cohort
 *  - /api/monetization/sku-performance — top SKUs by VND revenue
 *
 * All hooks return { data, loading, error } and re-fetch when gameId changes.
 */

import { useState, useEffect } from 'react';
import { apiFetch } from '../../../api/api-client';

// ---------------------------------------------------------------------------
// Shared types (mirror server response shapes)
// ---------------------------------------------------------------------------

export interface TierRow {
  tier: string;
  count: number;
  ltv: number;
  ltvPct: number;
}

export interface PayerTierData {
  snapshotAt: string;
  tiers: TierRow[];
  giniApprox: number;
  totalPayers: number;
  totalLtv: number;
}

export interface CohortLtvRow {
  installMonth: string;
  ageBand: string;
  cumulativeLtv: number;
  payerCount: number;
}

export interface CohortLtvData {
  snapshotAt: string;
  rows: CohortLtvRow[];
  note: string;
}

export interface SkuRow {
  productId: string;
  productName: string;
  revenue: number;
  txnCount: number;
}

export interface SkuData {
  snapshotAt: string;
  rows: SkuRow[];
  notAvailable: boolean;
  notAvailableReason?: string;
}

// ---------------------------------------------------------------------------
// Generic fetch hook
// ---------------------------------------------------------------------------

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useFetch<T>(url: string | null): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ data: null, loading: true, error: null });

    apiFetch<T>(url)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ data: null, loading: false, error: err.message });
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}

// ---------------------------------------------------------------------------
// Monetization hooks
// ---------------------------------------------------------------------------

export function usePayerTiers(gameId: string): FetchState<PayerTierData> {
  const url = gameId ? `/api/monetization/payer-tiers?game=${encodeURIComponent(gameId)}` : null;
  return useFetch<PayerTierData>(url);
}

export function useCohortLtv(gameId: string): FetchState<CohortLtvData> {
  const url = gameId ? `/api/monetization/cohort-ltv?game=${encodeURIComponent(gameId)}` : null;
  return useFetch<CohortLtvData>(url);
}

export function useSkuPerformance(gameId: string): FetchState<SkuData> {
  const url = gameId
    ? `/api/monetization/sku-performance?game=${encodeURIComponent(gameId)}&limit=20`
    : null;
  return useFetch<SkuData>(url);
}
