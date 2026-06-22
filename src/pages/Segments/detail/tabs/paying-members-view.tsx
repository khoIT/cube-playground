/**
 * "Paying users only" Members view. The stored member_tiers snapshot ranks the
 * FULL cohort and carries no per-uid LTV, so paying tiers can't come from
 * storage — they're recomputed live (top/middle/bottom-50 of the payer
 * sub-cohort) via GET /member-tiers?scope=paying. This wraps that fetch with
 * loading / empty / unavailable states and otherwise renders the same
 * TieredMembersView the default scope uses (one rendering path, no drift).
 */

import { ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemberTiers, Segment } from '../../../../types/segment-api';
import type { Preset } from '../../presets/types';
import { fetchPayingMemberTiers } from '../../../../api/segment-member-tiers';
import { TieredMembersView } from './tiered-members-view';
import { tierOptions } from './tier-view-model';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
  preset: Preset | null;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; tiers: MemberTiers }
  | { kind: 'empty' } // sub-scope applies but the cohort has no payers
  | { kind: 'unavailable' } // sub-scope doesn't apply (no rank measure / non-mf hub)
  | { kind: 'error'; message: string };

export function PayingMembersView({ segment, preset }: Props): ReactElement {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    fetchPayingMemberTiers(segment.id)
      .then((tiers) => {
        if (cancelled) return;
        if (!tiers) {
          setState({ kind: 'unavailable' });
        } else if (tierOptions(tiers).length === 0) {
          setState({ kind: 'empty' });
        } else {
          setState({ kind: 'ready', tiers });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [segment.id]);

  if (state.kind === 'loading') {
    return (
      <div className={styles.tabBody}>
        <div className={styles.skeletonRow} style={{ height: 40 }} />
        <div className={styles.skeletonRow} style={{ height: 220, marginTop: 12 }} />
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
          {t('segments.detail.members.paying.computing', {
            defaultValue: 'Ranking paying members…',
          })}
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return <div className={styles.errorState}>{state.message}</div>;
  }

  if (state.kind === 'empty') {
    return (
      <div className={styles.tabBody}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {t('segments.detail.members.paying.empty', {
            defaultValue: 'No paying users in this segment.',
          })}
        </p>
      </div>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <div className={styles.tabBody}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {t('segments.detail.members.paying.unavailable', {
            defaultValue: 'Paying-only ranking is not available for this segment.',
          })}
        </p>
      </div>
    );
  }

  // Same tiered renderer as the default scope — fed the live payer tiers.
  return <TieredMembersView segment={segment} preset={preset} tiers={state.tiers} />;
}
