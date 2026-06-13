/**
 * Issue-mix rail widget — horizontal bars by AI label category, with the
 * high-stakes families (Payment / Account / Security / Fraud / Refund) drawn in
 * brand orange so a CS lead's eye lands on the categories that matter for whales.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CsCareIssue } from '../../../../../api/segment-cs-care';

const HIGH_STAKES = /payment|account|security|fraud|refund|hack|ban/i;

interface Props {
  issueMix: CsCareIssue[];
}

export function CareIssueMix({ issueMix }: Props): ReactElement {
  const { t } = useTranslation();
  const max = Math.max(1, ...issueMix.map((i) => i.tickets));

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-alt)',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          marginBottom: 12,
        }}
      >
        {t('segments.detail.care.issueMix', { defaultValue: 'Issue mix' })}
      </div>
      {issueMix.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {t('segments.detail.care.noIssues', { defaultValue: 'No tickets in range.' })}
        </div>
      ) : (
        issueMix.map((issue) => {
          const high = HIGH_STAKES.test(issue.category);
          return (
            <div
              key={issue.category}
              style={{ display: 'grid', gridTemplateColumns: '88px 1fr 28px', alignItems: 'center', gap: 10, marginBottom: 9 }}
              title={t('segments.detail.care.issueMembers', {
                defaultValue: '{{members}} member(s)',
                members: issue.members,
              })}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {issue.category}
              </span>
              <span style={{ height: 16, background: 'var(--neutral-100)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <span
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${(issue.tickets / max) * 100}%`,
                    background: high ? 'var(--brand)' : 'var(--neutral-400)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                />
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, textAlign: 'right', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                {issue.tickets}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
