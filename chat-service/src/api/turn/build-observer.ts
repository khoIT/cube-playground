/**
 * Build the per-turn observability stack (DB trace recorder + Langfuse tracer,
 * plus an optional parallel-emit shadow pair for soak comparison).
 *
 * Extracted from the turn handler so the observer wiring is testable in
 * isolation and the handler keeps only orchestration. Construction is wrapped
 * in try/catch: a failing constructor (bad config, missing dep) degrades to a
 * no-op bundle rather than crashing a turn whose SSE headers are already sent.
 */

import type Database from 'better-sqlite3';
import * as chatStore from '../../db/chat-store.js';
import { config, isLangfuseEnabled } from '../../config.js';
import { LlmTraceRecorder, BufferedLlmTraceRecorder } from '../../observability/llm-trace-recorder.js';
import { LangfuseTracer } from '../../observability/langfuse-tracer.js';
import { buildCompositeObserver } from '../../observability/composite-observer.js';
import type { ObserverHooks } from '../../observability/observer-types.js';
import { TurnTracer } from '../../observability/turn-tracer.js';
import {
  RecordingObserver,
  RecordingSink,
} from '../../observability/parallel-emit-shim.js';

export interface TurnObserverBundle {
  observer: ObserverHooks | undefined;
  tracer: LangfuseTracer | undefined;
  bufferedRecorder: BufferedLlmTraceRecorder | undefined;
  /** Parallel-emit shadow pair — only allocated when the soak flag is on. */
  parallelLegacyRecorder: RecordingObserver | undefined;
  parallelShadowSink: RecordingSink | undefined;
  shadowTracer: TurnTracer | undefined;
}

interface BuildArgs {
  db: Database.Database;
  turnId: string;
  sessionId: string;
  ownerId: string;
  skill: string;
  logger: { warn: (obj: unknown, msg?: string) => void };
}

/**
 * Returns a fully-wired observer bundle, or an all-undefined bundle if
 * construction fails (logged, non-fatal).
 */
export function buildTurnObserver(args: BuildArgs): TurnObserverBundle {
  const { db, turnId, sessionId, ownerId, skill, logger } = args;
  try {
    // Recorder writes go through a buffer: the chat_turns FK rejects inserts
    // for the assistant turn until that row exists, and that INSERT happens
    // after the runner loop. The caller flushes once appendTurn has committed.
    const bufferedRecorder = new BufferedLlmTraceRecorder(
      new LlmTraceRecorder({ db, turnId }),
    );
    const tracer = new LangfuseTracer({ turnId, sessionId, ownerId, skill });
    const observers: ObserverHooks[] = [bufferedRecorder, tracer];

    let parallelLegacyRecorder: RecordingObserver | undefined;
    let parallelShadowSink: RecordingSink | undefined;
    let shadowTracer: TurnTracer | undefined;
    if (config.obsParallelEmitEnabled) {
      // Legacy capture: a no-op extra observer on the composite records what
      // the production path dispatches without writing anywhere. Shadow
      // capture: a TurnTracer whose only sink is an in-memory recorder — it
      // never touches the DB or Langfuse. Both are diffed after the loop.
      parallelLegacyRecorder = new RecordingObserver();
      observers.push(parallelLegacyRecorder);
      parallelShadowSink = new RecordingSink();
      shadowTracer = new TurnTracer({
        turnId,
        sessionId,
        model: config.chatModel,
        sinks: [parallelShadowSink],
      });
    }

    const observer = buildCompositeObserver(observers);
    chatStore.insertAudit(db, {
      sessionId,
      turnId,
      kind: 'observability',
      detail: { enabled_recorder: true, enabled_langfuse: isLangfuseEnabled(), owner_id: ownerId },
    });

    return {
      observer,
      tracer,
      bufferedRecorder,
      parallelLegacyRecorder,
      parallelShadowSink,
      shadowTracer,
    };
  } catch (obsErr) {
    logger.warn({ err: obsErr }, '[turn] observer construction failed — continuing without observability');
    return {
      observer: undefined,
      tracer: undefined,
      bufferedRecorder: undefined,
      parallelLegacyRecorder: undefined,
      parallelShadowSink: undefined,
      shadowTracer: undefined,
    };
  }
}
