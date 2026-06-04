/**
 * Per-member 360 page — `/#/segments/:id/members/:uid`.
 *
 * Reached by clicking a member row in a segment's Members tab. Resolves the
 * segment's game, then renders that game's 360 panel set live from Cube: a
 * profile header (KPI strip + vitals), the eager core panels, and a lazy
 * Behavior section for the event streams. Config-driven (member360-panels.ts),
 * so the page itself is game-agnostic.
 */

import { ReactElement, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, UserRound } from 'lucide-react';
import type { Segment } from '../../../types/segment-api';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import { panelsForGame } from './member360-panels';
import { MemberPanel } from './member-panel';
import { BehaviorSection } from './behavior-section';

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1200,
  margin: '0 auto',
};

export function Member360View(): ReactElement {
  const { t } = useTranslation();
  const { id, uid } = useParams<{ id: string; uid: string }>();
  const [segment, setSegment] = useState<Segment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSegment(null);
    setError(null);
    segmentsClient
      .get(id)
      .then((row) => !cancelled && setSegment(row))
      .catch((err: SegmentApiError) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const backLink = `/segments/${id}?tab=members`;
  const back = (
    <Link
      to={backLink}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        color: 'var(--text-secondary)',
        textDecoration: 'none',
        marginBottom: 12,
      }}
    >
      <ArrowLeft size={14} aria-hidden />
      {t('segments.member360.back', { defaultValue: 'Back to members' })}
    </Link>
  );

  if (error) {
    return (
      <main style={pageStyle}>
        {back}
        <div style={{ color: 'var(--destructive-ink, var(--text-muted))', fontSize: 13 }}>{error}</div>
      </main>
    );
  }

  const gameId = segment?.game_id ?? null;
  const panels = panelsForGame(gameId);
  const corePanels = panels.filter((p) => p.section === 'core');
  const behaviorPanels = panels.filter((p) => p.section === 'behavior');
  const profile = corePanels.find((p) => p.panelType === 'profile');
  const otherCore = corePanels.filter((p) => p.panelType !== 'profile');

  return (
    <main style={pageStyle}>
      {back}
      <header style={{ marginBottom: 20 }}>
        {gameId && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              color: 'var(--text-tertiary)',
              marginBottom: 4,
            }}
          >
            {gameId}{segment ? ` · ${segment.name}` : ''}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserRound size={20} aria-hidden style={{ color: 'var(--brand)' }} />
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--text-primary)',
              margin: 0,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {uid}
          </h1>
        </div>
      </header>

      {segment == null ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {t('segments.member360.loading', { defaultValue: 'Loading…' })}
        </div>
      ) : panels.length === 0 ? (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-lg)',
            padding: 20,
            fontSize: 13,
            color: 'var(--text-secondary)',
          }}
        >
          {t('segments.member360.unavailable', {
            defaultValue:
              'A per-member 360 is not configured for "{{game}}". It is available for games with a user_360 model (cfm, ballistar).',
            game: gameId ?? '—',
          })}
        </div>
      ) : (
        <>
          {profile && (
            <div style={{ marginBottom: 14 }}>
              <MemberPanel gameId={gameId} panel={profile} idValues={[uid]} />
            </div>
          )}
          <div
            style={{
              display: 'grid',
              gap: 14,
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            }}
          >
            {otherCore.map((p) => (
              <MemberPanel key={p.id} gameId={gameId} panel={p} idValues={[uid]} />
            ))}
          </div>
          <BehaviorSection gameId={gameId} uid={uid} panels={behaviorPanels} />
        </>
      )}
    </main>
  );
}

export default Member360View;
