/**
 * Persisted per-card checklist for an expanded Segment Refreshes row — which
 * cards are green, which serve a stale last-good value, which are hard-down.
 * Backed by the card cache (GET /api/segment-refresh/:id/cards), so unlike the
 * live checklist it works for passes run before this boot or on another
 * gateway. Three tones:
 *   ok            — last attempt succeeded (success dot)
 *   serving stale — status 'ok' but the latest attempt FAILED; the rendered
 *                   value is last-good (warning dot + value age)
 *   error         — no value to render at all (destructive dot)
 * Presentational; the row owns the fetch. Tokens only — no inline hex.
 */

import React from 'react';
import { fmtAge } from './segment-refresh-ops-data';
import type { SegmentCardStatus } from '../../../types/segment-refresh-ops';

type Tone = 'ok' | 'stale' | 'error';

function toneOf(card: SegmentCardStatus): Tone {
  if (card.status === 'error') return 'error';
  return card.error != null ? 'stale' : 'ok';
}

const TONE_DOT: Record<Tone, string> = {
  ok: 'var(--success-ink)',
  stale: 'var(--warning-ink)',
  error: 'var(--destructive-ink)',
};

function CardStatusLine({ card, now }: { card: SegmentCardStatus; now: number }) {
  const tone = toneOf(card);
  const valueAge = card.fetchedAt ? now - Date.parse(card.fetchedAt) : null;
  const title =
    tone === 'ok'
      ? `${card.cardId} — ok, value ${fmtAge(valueAge)}`
      : `${card.cardId} — ${card.error ?? 'failing'}`;
  return (
    <li style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }} title={title}>
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          margin: '0 2px',
          borderRadius: '50%',
          flexShrink: 0,
          background: TONE_DOT[tone],
        }}
      />
      <code
        style={{
          color: 'var(--text-primary)',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {card.cardId}
      </code>
      {tone === 'stale' && (
        <span style={{ fontSize: 10.5, color: 'var(--warning-ink)', flexShrink: 0 }}>
          last-good {fmtAge(valueAge)}
        </span>
      )}
      {tone === 'error' && (
        <span style={{ fontSize: 10.5, color: 'var(--destructive-ink)', flexShrink: 0 }}>failing</span>
      )}
    </li>
  );
}

export function CardStatusChecklist({ cards, now = Date.now() }: { cards: SegmentCardStatus[]; now?: number }) {
  if (cards.length === 0) return null;
  const ok = cards.filter((c) => toneOf(c) === 'ok').length;
  const stale = cards.filter((c) => toneOf(c) === 'stale').length;
  const error = cards.length - ok - stale;
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 5,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span>Cards ({cards.length})</span>
        <span style={{ color: 'var(--success-ink)' }}>{ok} ok</span>
        {stale > 0 && <span style={{ color: 'var(--warning-ink)' }}>{stale} serving last-good</span>}
        {error > 0 && <span style={{ color: 'var(--destructive-ink)' }}>{error} failing</span>}
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '3px 16px',
        }}
      >
        {cards.map((c) => (
          <CardStatusLine key={c.cardId} card={c} now={now} />
        ))}
      </ul>
    </div>
  );
}
