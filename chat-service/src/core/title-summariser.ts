/**
 * LLM-based session title summariser.
 * After turn 3, summarises the first few user messages into a short title
 * (≤32 chars) using a cheap model. The LLM call is fire-and-forget — it
 * must never block the main turn response.
 */

import type { ChatTurnRow } from '../types.js';

// ---------------------------------------------------------------------------
// Deps (injected for testability)
// ---------------------------------------------------------------------------

export interface TitleSummariserDeps {
  /** Call the LLM with a prompt; return the raw text response. */
  callLlm: (prompt: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Summarise
// ---------------------------------------------------------------------------

const MAX_TITLE_LEN = 32;

/**
 * Build a prompt from the first 3 user messages and ask the LLM for a
 * 3-word title. Returns the trimmed, truncated string.
 */
export async function summariseTitle(opts: {
  turns: ChatTurnRow[];
  deps: TitleSummariserDeps;
}): Promise<string> {
  const { turns, deps } = opts;

  // Collect the first 3 non-empty user messages
  const userTexts = turns
    .filter((t) => t.role === 'user' && t.user_text)
    .slice(0, 3)
    .map((t) => t.user_text as string);

  if (userTexts.length === 0) return '';

  const conversation = userTexts.join(' | ');
  const prompt =
    `Summarise this analyst conversation in exactly 3 words. ` +
    `Reply with only the 3-word title, no punctuation. ` +
    `Conversation: ${conversation}`;

  const raw = await deps.callLlm(prompt);

  // Collapse whitespace and truncate
  const title = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LEN);
  return title;
}
