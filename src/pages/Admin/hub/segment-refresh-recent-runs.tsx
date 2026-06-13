/**
 * "Recent passes" strip for an expanded Segment Refreshes row: the persisted
 * history of the last few card-runner passes (GET /api/segment-refresh/:id/runs),
 * newest first. Each line answers "which run, how old, who triggered it, how did
 * it go" — the question the live checklist (latest pass only, in-memory) and the
 * card cache's undated error breadcrumbs couldn't. Presentational; the row owns
 * the fetch. Tokens only — no inline hex.
 */

import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { fmtAge } from './segment-refresh-ops-data';
import type { SegmentCardRun } from '../../../types/segment-refresh-ops';

function RunLine({ run, now }: { run: SegmentCardRun; now: number }) {
  const [open, setOpen] = useState(false);
  const endedMs = run.finishedAt ? Date.parse(run.finishedAt) : NaN;
  const age = Number.isNaN(endedMs) ? null : now - endedMs;
  const startedMs = Date.parse(run.startedAt);
  const durationS =
    !Number.isNaN(endedMs) && !Number.isNaN(startedMs)
      ? Math.max(0, Math.round((endedMs - startedMs) / 1000))
      : null;
  const failed = run.failed > 0 || run.runError != null;
  const expandable = run.failingCards.length > 0 || run.runError != null;

  return (
    <li style={{ fontSize: 11.5, lineHeight: 1.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <button
          type="button"
          onClick={() => expandable && setOpen((v) => !v)}
          aria-label={open ? 'Collapse run detail' : 'Expand run detail'}
          disabled={!expandable}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: expandable ? 'pointer' : 'default',
            padding: 0,
            display: 'flex',
            color: expandable ? 'var(--text-muted)' : 'transparent',
          }}
        >
          <ChevronRight
            size={12}
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}
          />
        </button>
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            flexShrink: 0,
            background: failed ? 'var(--destructive-ink)' : 'var(--success-ink)',
          }}
        />
        <span style={{ color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {fmtAge(age)}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>· {run.source}</span>
        {durationS != null && <span style={{ color: 'var(--text-muted)' }}>· {durationS}s</span>}
        <span style={{ color: 'var(--text-secondary)' }}>
          · <span style={{ color: 'var(--success-ink)' }}>{run.ok}/{run.total} ok</span>
        </span>
        <span style={{ color: run.failed > 0 ? 'var(--destructive-ink)' : 'var(--text-muted)' }}>
          · {run.failed} failed
        </span>
        {run.runError != null && (
          <span style={{ color: 'var(--destructive-ink)', fontStyle: 'italic' }}>· pass aborted</span>
        )}
      </div>
      {open && expandable && (
        <div style={{ padding: '3px 0 4px 25px' }}>
          {run.runError != null && (
            <div style={{ fontSize: 11.5, color: 'var(--destructive-ink)', marginBottom: 3 }}>
              {run.runError}
            </div>
          )}
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {run.failingCards.map((c) => (
              <li key={c.cardId} style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                <code style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{c.cardId}</code>
                {c.error ? <span style={{ color: 'var(--text-muted)' }}> — {c.error}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function RecentRunsStrip({ runs, now = Date.now() }: { runs: SegmentCardRun[]; now?: number }) {
  if (runs.length === 0) return null;
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
        }}
      >
        Recent passes ({runs.length})
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {runs.map((r) => (
          <RunLine key={r.id} run={r} now={now} />
        ))}
      </ul>
    </div>
  );
}
