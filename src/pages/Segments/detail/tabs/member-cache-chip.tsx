/**
 * Per-member "360 precomputed" readiness chip for the tiered Members table.
 * One aggregate fetch per table mount (GET /member-cache-status — never N+1);
 * each row renders a small dot+label chip: ready (all core panels cached ok),
 * partial (some), none (nothing cached yet — page will load live).
 */

import { ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  segmentsClient,
  type MemberCacheStatusResponse,
} from '../../../../api/segments-client';

export function useMemberCacheStatus(
  segmentId: string,
  enabled: boolean,
): MemberCacheStatusResponse | null {
  const [status, setStatus] = useState<MemberCacheStatusResponse | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    segmentsClient
      .memberCacheStatus(segmentId)
      .then((res) => !cancelled && setStatus(res))
      .catch(() => {
        // Chip is an affordance, not a feature gate — fetch failure renders nothing.
      });
    return () => {
      cancelled = true;
    };
  }, [segmentId, enabled]);

  return status;
}

type ChipState = 'ready' | 'partial' | 'none';

function chipState(status: MemberCacheStatusResponse, uid: string): ChipState {
  const s = status.uids[uid];
  if (!s || s.ok === 0) return 'none';
  return status.panel_count > 0 && s.ok >= status.panel_count ? 'ready' : 'partial';
}

const CHIP_TOKENS: Record<ChipState, { bg: string; ink: string }> = {
  ready: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
  partial: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
  none: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
};

export function MemberCacheChip({
  status,
  uid,
}: {
  status: MemberCacheStatusResponse;
  uid: string;
}): ReactElement {
  const { t } = useTranslation();
  const state = chipState(status, uid);
  const tokens = CHIP_TOKENS[state];
  const labels: Record<ChipState, string> = {
    ready: t('segments.detail.members.cache.ready', { defaultValue: 'cached' }),
    partial: t('segments.detail.members.cache.partial', { defaultValue: 'partial' }),
    none: t('segments.detail.members.cache.none', { defaultValue: 'live' }),
  };
  const tooltips: Record<ChipState, string> = {
    ready: t('segments.detail.members.cache.readyTip', {
      defaultValue: '360 page precomputed — opens from cache',
    }),
    partial: t('segments.detail.members.cache.partialTip', {
      defaultValue: 'Some 360 panels precomputed; the rest load live',
    }),
    none: t('segments.detail.members.cache.noneTip', {
      defaultValue: 'Not precomputed yet — 360 page loads live',
    }),
  };
  return (
    <span
      title={tooltips[state]}
      style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 8px',
        borderRadius: 999,
        background: tokens.bg,
        color: tokens.ink,
        whiteSpace: 'nowrap',
      }}
    >
      {labels[state]}
    </span>
  );
}
