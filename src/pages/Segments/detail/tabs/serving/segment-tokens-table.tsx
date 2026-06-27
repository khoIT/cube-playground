/**
 * Read-only list of the API keys entitled to pull this served segment, each
 * flagged entitled-but-idle vs has-actually-pulled (audit-derived). Minting /
 * revoking lives in the admin API-keys tab — this surface deep-links there rather
 * than duplicating token CRUD. The /tokens endpoint is admin-only; a non-admin
 * viewer gets a 403 and sees just the deep-link.
 */

import { ReactElement, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ArrowUpRight } from 'lucide-react';
import { segmentsClient } from '../../../../../api/segments-client';
import { SegmentApiError } from '../../../../../api/api-client';
import type { SegmentTokenInfo } from '../../../../../types/segment-api';
import { relative } from './serving-format';

const ACCENT = 'var(--layer-segment, #725390)';

function chip(bg: string, color: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1px 7px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    background: bg,
    color,
  };
}

export function SegmentTokensTable({ segmentId }: { segmentId: string }): ReactElement {
  const [tokens, setTokens] = useState<SegmentTokenInfo[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    segmentsClient
      .getTokens(segmentId)
      .then((r) => {
        if (!cancelled) setTokens(r.tokens);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof SegmentApiError && err.status === 403) setForbidden(true);
        else setTokens([]);
      });
    return () => {
      cancelled = true;
    };
  }, [segmentId]);

  const manageLink = (
    <Link
      to="/admin/api-keys"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: ACCENT, fontWeight: 600 }}
    >
      Manage tokens <ArrowUpRight size={13} aria-hidden />
    </Link>
  );

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-lg, 10px)', padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          <KeyRound size={14} aria-hidden /> Tokens entitled to pull
        </span>
        <span style={{ marginLeft: 'auto' }}>{manageLink}</span>
      </div>

      {forbidden && (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
          Token details are admin-only. {manageLink} in the admin console.
        </p>
      )}

      {!forbidden && tokens != null && tokens.length === 0 && (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
          No keys are scoped to this segment yet. Issue one in the admin API-keys tab and scope it here.
        </p>
      )}

      {!forbidden && tokens != null && tokens.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tokens.map((tk) => (
            <div key={tk.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{tk.label}</span>
              <span
                style={chip(
                  tk.appliesVia === 'segment' ? 'var(--info-soft)' : 'var(--muted-soft)',
                  tk.appliesVia === 'segment' ? 'var(--info-ink)' : 'var(--muted-ink)',
                )}
              >
                {tk.appliesVia === 'segment' ? 'this segment' : 'all segments'}
              </span>
              {tk.everPulled ? (
                <span style={chip('var(--success-soft)', 'var(--success-ink)')}>pulled</span>
              ) : (
                <span style={chip('var(--muted-soft)', 'var(--muted-ink)')}>idle</span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
                last used {relative(tk.lastUsedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
