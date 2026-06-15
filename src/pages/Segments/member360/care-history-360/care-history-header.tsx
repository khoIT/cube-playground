/**
 * Care History 360 header: back link, member identity, LTV + CS-side VIP tier,
 * pre→post recharge delta around first contact, and the Inbox/Timeline view
 * toggle. Risk is intentionally omitted here — it's a watchlist-relative metric.
 */

import { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import type { CsTicketsPayload } from '../../../../api/segment-cs-care-member';
import { fmtVnd, fmtPct } from '../../detail/tabs/care/care-ui-atoms';
import { InfoTip } from './care-history-info-tip';

export type CareView = 'inbox' | 'timeline';

interface Props {
  payload: CsTicketsPayload;
  view: CareView;
  onViewChange: (v: CareView) => void;
}

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }): ReactElement {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
        {label}
        {hint && <InfoTip text={hint} />}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em', color: tone ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

export function CareHistoryHeader({ payload, view, onViewChange }: Props): ReactElement {
  const { t } = useTranslation();
  const vip = payload.tickets.find((tk) => tk.vip)?.vip ?? null;
  const delta = payload.recharge?.deltaPct ?? null;

  return (
    <div style={{ marginBottom: 16 }}>
      <Link
        to={`/segments/${payload.segmentId}?tab=care`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: 10 }}
      >
        <ArrowLeft size={14} aria-hidden />
        {t('segments.detail.care.backToCare', { defaultValue: 'Back to Care' })}
      </Link>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
            {payload.gameId} · {t('segments.detail.care.title', { defaultValue: 'CS Care History' })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3 }}>
            <Link
              to={`/segments/${payload.segmentId}/members/${encodeURIComponent(payload.uid)}`}
              title={t('segments.detail.care.openMember360', { defaultValue: 'Open Member 360 profile' })}
              style={{ fontSize: 20, fontWeight: 700, color: 'var(--brand)', textDecoration: 'none' }}
            >
              {payload.member.name ?? payload.uid}
            </Link>
            {payload.member.name && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{payload.uid}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 22, flexWrap: 'wrap' }}>
          {payload.member.ltv != null && <Kpi label={t('segments.detail.care.col.ltv', { defaultValue: 'LTV' })} value={fmtVnd(payload.member.ltv)} />}
          {vip?.tierId != null && (
            <Kpi
              label={t('segments.detail.care.vipTier', { defaultValue: 'VIP tier' })}
              value={`${vip.tierId}${vip.vipGameProportion != null ? ` · ${vip.vipGameProportion}` : ''}`}
              hint={
                vip.vipGameProportion != null
                  ? t('segments.detail.care.vipTierHelp', {
                      defaultValue:
                        'CS VIP tier {{tier}} (scale 0–5; 5 is highest). The {{pct}}% is vip_game_proportion — the share of this player’s cross-game VIP value that sits in this game. {{pct}}% means this title is their primary game.',
                      tier: vip.tierId,
                      pct: Math.round(vip.vipGameProportion * 100),
                    })
                  : t('segments.detail.care.vipTierHelpNoProp', {
                      defaultValue: 'CS VIP tier {{tier}} (scale 0–5; 5 is highest).',
                      tier: vip.tierId,
                    })
              }
            />
          )}
          {delta != null && (
            <Kpi
              label={t('segments.detail.care.recharge30d', { defaultValue: 'Recharge {{d}}d', d: payload.recharge?.windowDays ?? 30 })}
              value={fmtPct(delta)}
              tone={delta < 0 ? 'var(--destructive-ink)' : 'var(--positive)'}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-full)', overflow: 'hidden', alignSelf: 'center' }}>
            {(['inbox', 'timeline'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onViewChange(v)}
                style={{
                  border: 'none',
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  background: view === v ? 'var(--brand)' : 'transparent',
                  color: view === v ? 'var(--text-on-brand)' : 'var(--text-secondary)',
                }}
              >
                {v === 'inbox'
                  ? t('segments.detail.care.viewInbox', { defaultValue: 'Inbox' })
                  : t('segments.detail.care.viewTimeline', { defaultValue: 'Timeline' })}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
