/**
 * Pure functions for response-cache key derivation + text normalization.
 *
 * Key = sha256(skill|gameId|normalize(userText)|cubeMetaHash|model|systemPromptHash)
 *
 * Normalization: lowercase + collapse whitespace + strip trailing punctuation.
 * No stemming / synonym handling — that is phase 07.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

/**
 * Normalize user text for cache key comparison.
 * Matches the phase spec: lowercase, collapse whitespace, strip trailing [.,!?…]+
 */
export function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?…]+$/u, '');
}

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------

/** sha256 of arbitrary string input → hex digest. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Hash the system prompt string for cache key inclusion. */
export function hashSystemPrompt(systemPrompt: string): string {
  return sha256(systemPrompt);
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

export interface CacheKeyParams {
  skill: string;
  gameId: string;
  userText: string;
  cubeMetaHash: string;
  model: string;
  systemPromptHash: string;
}

/**
 * Derive a deterministic cache key from the normalized turn inputs.
 * Returns a 64-char hex string (sha256).
 */
export function computeCacheKey(params: CacheKeyParams): string {
  const normalized = normalize(params.userText);
  const raw = [
    params.skill,
    params.gameId,
    normalized,
    params.cubeMetaHash,
    params.model,
    params.systemPromptHash,
  ].join('|');
  return sha256(raw);
}

// ---------------------------------------------------------------------------
// Text chunking for SSE replay
// ---------------------------------------------------------------------------

/**
 * Chunk text into windows of approximately `size` characters for replay streaming.
 * Preserves visual streaming parity with live turns (~80-char window default).
 */
export function chunkText(text: string, size = 80): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
