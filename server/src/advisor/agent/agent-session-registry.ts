/**
 * In-memory registry of advisor agent sessions: create / resume / evict.
 *
 * Sessions are ephemeral (lost on restart) — acceptable for v1; a durable store
 * is a later follow-up. TTL eviction aborts idle sessions so their SDK
 * subprocesses don't leak. The per-session in-flight lock lives on the session
 * (`busy`); the route rejects overlapping turns with 409.
 */

import { randomUUID } from 'node:crypto';
import { createAdvisorAgentSession, type AdvisorAgentSession } from './agent-runtime.js';
import type { AuditLogger } from './agent-audit-log.js';
import type { SessionOpts, SessionStatus } from './agent-types.js';

const DEFAULT_TTL_MS = 30 * 60_000; // 30 minutes idle

export class AgentSessionRegistry {
  private readonly sessions = new Map<string, AdvisorAgentSession>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  /** Create a fresh session. Propagates OAuthTokenMissingError to the caller. */
  create(opts: SessionOpts, logger?: AuditLogger): AdvisorAgentSession {
    this.evictExpired();
    const id = randomUUID();
    const session = createAdvisorAgentSession(id, opts, logger);
    this.sessions.set(id, session);
    return session;
  }

  /** Resume an existing, non-closed session, or undefined. */
  get(id: string): AdvisorAgentSession | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (s.isClosed() || this.isExpired(s)) {
      this.drop(id);
      return undefined;
    }
    return s;
  }

  /** Abort + remove a session. */
  drop(id: string): void {
    const s = this.sessions.get(id);
    if (s) {
      s.abort('evicted');
      this.sessions.delete(id);
    }
  }

  /** Sweep idle/closed sessions. Called on each create; safe to call anytime. */
  evictExpired(): void {
    for (const [id, s] of this.sessions) {
      if (s.isClosed() || this.isExpired(s)) {
        s.abort('evicted');
        this.sessions.delete(id);
      }
    }
  }

  size(): number {
    return this.sessions.size;
  }

  status(id: string): SessionStatus | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    return {
      sessionId: s.id,
      scope: s.opts.scope,
      goal: s.opts.goal,
      turns: s.turnIndex,
      totalCostUsd: s.totalCostUsd,
      busy: s.busy,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
    };
  }

  private isExpired(s: AdvisorAgentSession): boolean {
    return Date.now() - s.lastActiveAt > this.ttlMs;
  }
}

/** Process-wide singleton used by the route. */
export const agentSessions = new AgentSessionRegistry();
