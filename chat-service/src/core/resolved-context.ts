/**
 * Resolved-context projection for the agent system prompt (P2).
 *
 * Reads the SAME session disambiguation memory the deterministic engine writes
 * (`getResolutions`) and renders a terse "Resolved so far" block so the agent
 * stops re-asking what's already pinned. There is ONE store and ONE rephrase
 * gate (`hasSubstantialUnresolvedText` in disambiguate-memory-merge) — this
 * module only reads; it never introduces a second source of truth or a second
 * keep-until-rephrase policy.
 */

import type Database from 'better-sqlite3';
import { getResolutions } from '../cache/disambig-memory-adapter.js';
import type { ResolvedContext } from './agent-context-types.js';

/**
 * Project the session's resolved slots into a ResolvedContext. Absent slots
 * stay undefined. No clock re-resolution here — the stored phrase is what the
 * rendered block shows, and it is clock-independent.
 */
export function readResolvedContext(db: Database.Database, sessionId: string): ResolvedContext {
  const mem = getResolutions(db, sessionId);
  const ctx: ResolvedContext = {};
  if (mem.entity?.value) ctx.entity = { value: mem.entity.value, label: mem.entity.phrase };
  if (mem.metric?.value) ctx.metric = { value: mem.metric.value, label: mem.metric.phrase };
  if (mem.timeRange?.value) ctx.timeRange = { value: mem.timeRange.value, label: mem.timeRange.phrase };
  if (mem.concept?.value) ctx.concept = { value: mem.concept.value, label: mem.concept.phrase };
  if (mem.intent?.value) ctx.intent = { value: mem.intent.value, label: mem.intent.phrase };
  if (typeof mem.updatedAt === 'number') ctx.updatedAt = mem.updatedAt;
  return ctx;
}

function formatRange(r: string | [string, string]): string {
  return typeof r === 'string' ? r : `${r[0]} to ${r[1]}`;
}

const ALL_SLOTS = ['entity', 'metric', 'time window'] as const;

/**
 * Render a ResolvedContext to a terse text block. Returns '' when nothing is
 * resolved (avoids injecting an empty header). Names the still-open slots so
 * the agent knows the ONE question worth asking instead of re-asking settled
 * ones.
 */
export function renderResolvedContext(ctx: ResolvedContext): string {
  const pinned: string[] = [];
  const resolvedKeys = new Set<string>();

  if (ctx.entity) {
    const e = ctx.entity.value;
    const head = ctx.entity.label ?? e.cube;
    pinned.push(`- entity = ${head} (${e.cube}.${e.pk})`);
    resolvedKeys.add('entity');
  }
  if (ctx.metric) {
    pinned.push(`- metric = ${ctx.metric.label ?? ctx.metric.value}`);
    resolvedKeys.add('metric');
  }
  if (ctx.timeRange) {
    pinned.push(`- time window = ${ctx.timeRange.label ?? formatRange(ctx.timeRange.value.dateRange)}`);
    resolvedKeys.add('time window');
  }
  if (ctx.intent) pinned.push(`- intent = ${ctx.intent.value}`);
  if (ctx.concept && !ctx.metric) pinned.push(`- concept = ${ctx.concept.label ?? ctx.concept.value}`);

  if (pinned.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Resolved so far');
  lines.push('');
  lines.push('Already settled this session — reuse these and do NOT re-ask them unless the user rephrases the question:');
  lines.push(...pinned);

  const open = ALL_SLOTS.filter((s) => !resolvedKeys.has(s));
  if (open.length > 0 && open.length < ALL_SLOTS.length) {
    lines.push(`Still open (ask only if needed to answer): ${open.join(', ')}.`);
  }

  return lines.join('\n');
}
