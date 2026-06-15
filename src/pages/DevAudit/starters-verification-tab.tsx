/**
 * StartersVerificationTab — /dev/chat-audit/starters
 *
 * Review surface for the pregenerated starter-question verification workflow
 * (chat-service `npm run starters:pregenerate`). Renders the per-run report:
 * every candidate question with its two gate results —
 *   tier 1: clicked-chip pass-through query executed (row count)
 *   tier 2: real chat turn (duration, artifact count) with a transcript link
 * — so the question set can be reviewed without manually re-asking each one.
 *
 * Data source: GET /api/chat/debug/starter-verification-report (the JSON the
 * pregenerate script writes next to the seed file). 404 = no run recorded.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { T } from '../../shell/theme';
import { chatHeaders } from '../../api/chat-auth-headers';

interface GateResult {
  ok: boolean;
  reason?: string;
  detail?: string;
  rowCount?: number;
  ms?: number;
  artifactCount?: number;
  sessionId?: string | null;
}

interface ReportEntry {
  questionId: string;
  text: string;
  topic: string;
  kept: boolean;
  tier1: GateResult;
  tier2?: GateResult;
  query?: unknown;
}

interface VerificationReport {
  version: string;
  generatedAt: number;
  workspace: string;
  games: Record<string, { entries: ReportEntry[] }>;
}

/** Tier-2 durations above this read as "slow chip" in a live demo. */
const SLOW_TURN_MS = 120_000;

const TOPIC_LABELS: Record<string, string> = {
  liveops: 'LiveOps',
  user_acquisition: 'User Acquisition',
  monetization: 'Monetization',
};

export function StartersVerificationTab() {
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [state, setState] = useState<'loading' | 'empty' | 'ready' | 'error'>('loading');
  const [activeGame, setActiveGame] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/chat/debug/starter-verification-report', {
      headers: chatHeaders({ Accept: 'application/json' }),
      cache: 'no-store',
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) { setState('empty'); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as VerificationReport;
        setReport(data);
        setActiveGame(Object.keys(data.games)[0] ?? null);
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);

  if (state === 'loading') return <Centered>Loading verification report…</Centered>;
  if (state === 'empty') {
    return (
      <Centered>
        No verification run recorded yet — run{' '}
        <code style={{ fontFamily: T.fMono }}>npm run starters:pregenerate</code> in chat-service.
      </Centered>
    );
  }
  if (state === 'error' || !report) return <Centered>Failed to load the verification report.</Centered>;

  const games = Object.keys(report.games);
  const entries = activeGame ? report.games[activeGame]?.entries ?? [] : [];
  const kept = entries.filter((e) => e.kept).length;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', fontFamily: T.fSans }}>
      {/* Run header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--shell-text-emphasis)' }}>
          Verification run <code style={{ fontFamily: T.fMono }}>{report.version}</code>
        </span>
        <span style={{ fontSize: 12, color: 'var(--shell-text-subtle)' }}>
          {new Date(report.generatedAt).toLocaleString()} · workspace {report.workspace} ·{' '}
          {kept}/{entries.length} candidates shipped
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {games.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setActiveGame(g)}
              style={{
                padding: '3px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                border: `1px solid ${g === activeGame ? 'var(--shell-text)' : 'var(--shell-border-strong)'}`,
                background: g === activeGame ? 'var(--shell-text)' : 'transparent',
                color: g === activeGame ? 'var(--text-on-brand)' : 'var(--shell-text-secondary)',
              }}
            >
              {g}
            </button>
          ))}
        </span>
      </div>

      {/* One section per topic */}
      {Object.keys(TOPIC_LABELS).map((topic) => {
        const rows = entries.filter((e) => e.topic === topic);
        if (rows.length === 0) return null;
        return (
          <section key={topic} style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--shell-text-subtle)', margin: '0 0 8px' }}>
              {TOPIC_LABELS[topic]} — {rows.filter((r) => r.kept).length} shipped / {rows.length} candidates
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rows.map((e) => <EntryRow key={e.questionId} entry={e} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function EntryRow({ entry }: { entry: ReportEntry }) {
  const t2 = entry.tier2;
  const passed = entry.tier1.ok && t2?.ok === true;
  const slow = t2?.ok && (t2.ms ?? 0) > SLOW_TURN_MS;
  const failReason = !entry.tier1.ok
    ? `query ${entry.tier1.reason}`
    : t2 && !t2.ok
      ? `turn ${t2.reason}`
      : !t2
        ? 'not turn-verified (topic already full)'
        : null;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
        padding: '8px 12px', borderRadius: 8,
        border: `1px solid var(--shell-border)`,
        background: entry.kept ? 'var(--surface-raised)' : 'var(--surface-subtle)',
        opacity: entry.kept ? 1 : 0.75,
        fontSize: 13, color: 'var(--shell-text-emphasis)',
      }}
    >
      <Pill
        text={passed ? '✓ verified' : failReason ?? '—'}
        soft={passed ? 'var(--success-soft)' : 'var(--destructive-soft)'}
        ink={passed ? 'var(--success-ink)' : 'var(--destructive-ink)'}
      />
      {entry.kept && <Pill text="shipped" soft="var(--info-soft)" ink="var(--info-ink)" />}
      {slow && (
        <Pill
          text={`slow ${Math.round((t2!.ms ?? 0) / 1000)}s`}
          soft="var(--warning-soft)"
          ink="var(--warning-ink)"
        />
      )}
      <span style={{ flex: 1, minWidth: 240 }}>{entry.text}</span>
      <span style={{ fontSize: 11, color: 'var(--shell-text-subtle)', fontFamily: T.fMono, whiteSpace: 'nowrap' }}>
        {entry.tier1.rowCount != null && `rows ${entry.tier1.rowCount}`}
        {t2?.ok && ` · ${Math.round((t2.ms ?? 0) / 1000)}s · ${t2.artifactCount} artifact`}
      </span>
      {t2?.sessionId && (
        <Link
          to={`/dev/chat-audit/sessions/${t2.sessionId}`}
          style={{ fontSize: 12, color: 'var(--shell-text-muted)', whiteSpace: 'nowrap' }}
        >
          transcript →
        </Link>
      )}
      {entry.query != null && (
        <details style={{ width: '100%' }}>
          <summary style={{ fontSize: 11, color: 'var(--shell-text-subtle)', cursor: 'pointer' }}>pass-through query</summary>
          <pre
            style={{
              margin: '6px 0 0', padding: 10, borderRadius: 8, overflow: 'auto',
              background: 'var(--surface-subtle)', fontSize: 11, fontFamily: T.fMono, color: 'var(--shell-text-secondary)',
            }}
          >
            {JSON.stringify(entry.query, null, 2)}
          </pre>
        </details>
      )}
      {failReason && (entry.tier1.detail || t2?.detail) && (
        <div style={{ width: '100%', fontSize: 11, color: 'var(--destructive-ink)' }}>
          {entry.tier1.detail ?? t2?.detail}
        </div>
      )}
    </div>
  );
}

function Pill({ text, soft, ink }: { text: string; soft: string; ink: string }) {
  return (
    <span
      style={{
        padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.03em',
        background: soft, color: ink, whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--shell-text-subtle)', fontSize: 13, fontFamily: T.fSans, padding: 24 }}>
      <span>{children}</span>
    </div>
  );
}
