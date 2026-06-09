/**
 * Per-member 360 page — `/#/segments/:id/members/:uid`.
 *
 * Reached by clicking a member row in a segment's Members tab. Renders a
 * dashboard (modeled on cfm-user360) live from Cube: hero + monetization +
 * profile/acquisition + journey (timeline + trend charts) + tabbed details.
 * The whole top of the page is driven by ONE `user_profile` row; journey and
 * details panels fetch their own scoped queries. Config-driven per game
 * (member360-sections.ts / member360-panels.ts).
 */

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import type { Query } from '@cubejs-client/core';
import type { Segment } from '../../../types/segment-api';
import { segmentsClient } from '../../../api/segments-client';
import { SegmentApiError } from '../../../api/api-client';
import { sectionsForGame, profileMembers } from './member360-sections';
import { useCubeApiBootstrap } from '../../../hooks';
import { useMemberCubeQuery } from './use-member-cube-query';
import { useCachedPanelSource } from './use-cached-panel-source';
import { DashboardHero } from './sections/dashboard-hero';
import { SectionCard } from './sections/dashboard-stats';
import { MonetizationBand } from './sections/monetization-band';
import { ProfileStatusGroups } from './sections/profile-status-groups';
import { AcquisitionStrip } from './sections/acquisition-strip';
import { DashboardJourney } from './sections/dashboard-journey';
import { DetailsTabs } from './sections/details-tabs';
import { Member360CoverageNotice } from './member360-coverage-notice';
import { CsMember360View } from '../../Dashboards/cs/member360/cs-member360-view';

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1200,
  margin: '0 auto',
};

export function Member360View(): ReactElement {
  const { t } = useTranslation();
  // Reachable both under /segments (already bootstrapped) and standalone from the
  // CS care queue — bootstrap Cube creds here so the standalone route can query.
  useCubeApiBootstrap();
  const { id, uid: rawUid } = useParams<{ id?: string; uid: string }>();
  const location = useLocation();
  // Segment-less mode: reached from the CS care queue, which has no backing
  // segment. The game is carried on the URL (?game=) and the back-link returns
  // to the queue instead of a segment's members tab.
  const segmentLess = !id;
  const careGame = useMemo(
    () => new URLSearchParams(location.search).get('game') || null,
    [location.search],
  );
  // The Members-tab link encodes the uid (vopenid uids contain '@' → %40), and
  // react-router v5 does NOT decode route params. Recover the literal uid before
  // it feeds the Cube `user_id equals` filter / cache key — otherwise a game
  // whose uids contain '@' (jus_vn, cfm vopenid) matches zero rows. Plain numeric
  // uids decode to themselves; fall back to raw on malformed encoding.
  const uid = useMemo(() => {
    try {
      return decodeURIComponent(rawUid);
    } catch {
      return rawUid;
    }
  }, [rawUid]);
  const [segment, setSegment] = useState<Segment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSegment(null);
    setError(null);
    // No segment to resolve in care mode — the game comes from the URL.
    if (!id) return;
    segmentsClient
      .get(id)
      .then((row) => !cancelled && setSegment(row))
      .catch((err: SegmentApiError) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const gameId = segment?.game_id ?? (segmentLess ? careGame : null);
  const sections = sectionsForGame(gameId);

  // Nightly precompute cache — one panel-map fetch per (segment, uid). The
  // cached `profile` panel row covers the whole top of the page when fresh.
  const cachedSource = useCachedPanelSource(id, uid);
  const cachedProfileRow = useMemo<Record<string, unknown> | null>(() => {
    if (!sections) return null;
    const hit = cachedSource.getCached('profile');
    const row0 = hit?.rows[0];
    if (!row0) return null;
    // Coverage guard: serve from cache only when every member the section
    // layout reads is present — registry/section drift falls back to live.
    return profileMembers(sections).every((m) => m in row0) ? (row0 as Record<string, unknown>) : null;
  }, [cachedSource, sections]);

  // One query powers the hero + monetization + profile/acquisition + journey
  // dots — held idle until the cache lookup settles, skipped on a cache hit.
  const profileQuery = useMemo<Query | null>(
    () =>
      sections && cachedSource.ready && cachedProfileRow == null
        ? {
            dimensions: profileMembers(sections),
            filters: [{ member: 'user_profile.user_id', operator: 'equals' as never, values: [uid] }],
            limit: 1,
          }
        : null,
    [sections, uid, cachedSource.ready, cachedProfileRow],
  );
  const { rows: profileRows, loading: profileLoading } = useMemberCubeQuery<Record<string, unknown>>(
    gameId,
    profileQuery,
  );
  const row = cachedProfileRow ?? profileRows[0] ?? null;

  const back = (
    <Link
      to={
        segmentLess
          ? `/dashboards/cs/queue?game=${encodeURIComponent(careGame ?? '')}`
          : `/segments/${id}?tab=members`
      }
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
      {segmentLess
        ? t('segments.member360.backToQueue', { defaultValue: 'Back to action queue' })
        : t('segments.member360.back', { defaultValue: 'Back to members' })}
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

  if (sections == null && (segment != null || segmentLess)) {
    return (
      <main style={pageStyle}>
        {back}
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
      </main>
    );
  }

  // Care-first layout when reached from the CS care queue: the care timeline is
  // the central action and the rest of the 360 folds into reference panels. The
  // Segments path keeps the existing stacked dashboard below.
  if (segmentLess && sections && gameId) {
    return (
      <main style={pageStyle}>
        <CsMember360View
          gameId={gameId}
          uid={uid}
          sections={sections}
          row={row}
          profileLoading={profileLoading}
          cachedSource={cachedSource}
        />
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      {back}
      {gameId && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
            color: 'var(--text-tertiary)',
            marginBottom: 8,
          }}
        >
          {gameId}{segment ? ` · ${segment.name}` : ''}
        </div>
      )}

      {sections && <Member360CoverageNotice gameId={gameId} />}

      {sections && <DashboardHero uid={uid} sections={sections} row={row} />}

      {sections && (
        <>
          {profileLoading && row == null && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
              {t('segments.member360.loading', { defaultValue: 'Loading…' })}
            </div>
          )}

          <SectionCard icon="💰" title={t('segments.member360.monetization', { defaultValue: 'Monetization' })}>
            <MonetizationBand config={sections.monetization} row={row} />
          </SectionCard>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 0, columnGap: 24 }}>
            <SectionCard icon="🪪" title={t('segments.member360.profileStatus', { defaultValue: 'Profile & status' })}>
              <ProfileStatusGroups groups={sections.profileGroups} statusChips={sections.statusChips} row={row} />
            </SectionCard>
            <SectionCard icon="📥" title={t('segments.member360.acquisition', { defaultValue: 'Acquisition' })}>
              <AcquisitionStrip timeline={sections.acquisitionTimeline} chips={sections.acquisitionChips} row={row} />
            </SectionCard>
          </div>

          <DashboardJourney gameId={gameId} uid={uid} sections={sections} row={row} cachedSource={cachedSource} />
          {/* showCareTab always true — CareHistoryTab handles empty state gracefully
              when no care cases exist yet for the active game. */}
          <DetailsTabs gameId={gameId} uid={uid} cachedSource={cachedSource} showCareTab />
        </>
      )}
    </main>
  );
}

export default Member360View;
