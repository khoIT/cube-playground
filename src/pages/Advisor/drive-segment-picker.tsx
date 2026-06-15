/**
 * Segment picker for a game-scope Drive hand-off. A draft's cohort IS a segment,
 * so when the manager drove at game scope (no segment in the URL) we ask which
 * segment to build the experiment for, then re-scope the investigation to it.
 */

import React, { useEffect, useState } from 'react';
import { X, Target } from 'lucide-react';
import { segmentsClient } from '../../api/segments-client';
import { Btn, CARD_STYLE, Eyebrow } from './advisor-primitives';
import type { Segment } from '../../types/segment-api';

export function DriveSegmentPicker({
  gameId,
  onClose,
  onPick,
}: {
  gameId: string;
  onClose: () => void;
  onPick: (segmentId: string) => void;
}) {
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    segmentsClient
      .list({ owner: '*', game_id: gameId, sort: 'size' })
      .then((rows) => alive && setSegments(rows.filter((s) => s.type === 'predicate')))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [gameId]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ...CARD_STYLE, width: 'min(560px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 0 }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', borderBottom: '1px solid var(--border-card)' }}>
          <Target size={17} color="var(--brand)" aria-hidden />
          <div style={{ flex: 1 }}>
            <Eyebrow>Pick the target segment</Eyebrow>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
              An experiment runs on a segment cohort — choose who to build it for.
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </header>

        <div style={{ overflowY: 'auto', padding: '8px 0' }}>
          {error && (
            <div style={{ padding: '12px 18px', color: 'var(--destructive-ink)', fontSize: 13 }}>
              Couldn't load segments: {error}
            </div>
          )}
          {!error && segments == null && (
            <div style={{ padding: '12px 18px', color: 'var(--text-muted)', fontSize: 13 }}>Loading segments…</div>
          )}
          {segments != null && segments.length === 0 && (
            <div style={{ padding: '12px 18px', color: 'var(--text-muted)', fontSize: 13 }}>
              No predicate segments for {gameId} yet — build one in Segments first.
            </div>
          )}
          {segments?.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              style={{
                display: 'flex',
                width: '100%',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 12,
                padding: '11px 18px',
                border: 'none',
                borderBottom: '1px solid var(--bg-muted)',
                background: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
                {s.uid_count.toLocaleString()} members
              </span>
            </button>
          ))}
        </div>

        <footer style={{ padding: '10px 18px', borderTop: '1px solid var(--border-card)', display: 'flex', justifyContent: 'flex-end' }}>
          <Btn sm onClick={onClose}>Cancel</Btn>
        </footer>
      </div>
    </div>
  );
}
