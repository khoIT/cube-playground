/**
 * Decides whether the engine's resolved query is good enough to auto-run
 * or whether the LLM should ask a clarification. Targeted mode always
 * clarifies when any clarifications were produced; aggressive mode trusts
 * the result up to the configured confidence threshold.
 */

import { config } from '../config.js';
import type {
  ChatDisambiguationMode,
  Clarification,
  EngineAction,
} from './types.js';

export interface GateInput {
  mode: ChatDisambiguationMode;
  overallConfidence: number;
  clarifications: Clarification[];
  threshold?: number;
}

export function modeGate(input: GateInput): EngineAction {
  const threshold = input.threshold ?? config.disambigAutoThreshold;

  // Targeted: clarify whenever the engine produced any clarification.
  if (input.mode === 'targeted') {
    return input.clarifications.length > 0 ? 'clarify' : 'auto';
  }

  // Aggressive: auto only when both confident and clarification-free.
  if (input.clarifications.length === 0) return 'auto';
  return input.overallConfidence >= threshold ? 'auto' : 'clarify';
}
