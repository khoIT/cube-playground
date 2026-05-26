/**
 * Compose the system prompt for a turn by concatenating:
 *   1. Master command body (cube-playground.md) — cached at module level.
 *   2. Active skill body (SKILL.md) via skill-loader cache.
 *   3. Active game context line.
 *   4. Optional context preamble (page URL, selected blocks, etc.)
 *
 * Returns both the composed system prompt and the skill's allowed tool names
 * so claude-runner can subset the tool registry accordingly.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkill } from './skill-loader.js';
import { renderFocusPreamble, type SessionFocus } from '../cache/session-focus-adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MASTER_CMD_PATH = resolve(__dirname, '../../.claude/commands/cube-playground.md');

// Read the master command once and cache it for the lifetime of the process.
let masterCommandCache: string | null = null;

function readMasterCommand(): string {
  if (masterCommandCache !== null) return masterCommandCache;
  masterCommandCache = existsSync(MASTER_CMD_PATH)
    ? readFileSync(MASTER_CMD_PATH, 'utf-8').trim()
    : '';
  return masterCommandCache;
}

export interface ComposeParams {
  skill: string;
  game: string;
  contextPreamble?: string;
  /**
   * Phase 02 — optional focus snapshot. When provided AND
   * non-empty, the resulting system prompt carries a `## Conversation
   * focus` block summarising the prior turn's metric / dimension /
   * timeRange / artifact. Caller is responsible for the flag gate
   * (see `getFocus` in session-focus-adapter); pass `undefined` to skip.
   */
  focus?: SessionFocus;
}

export interface ComposeResult {
  systemPrompt: string;
  allowedToolNames: string[];
}

const FALLBACK_SKILL = 'explore';

/**
 * Build the full system prompt for a turn and return the skill's allowed tool names.
 * Falls back to 'explore' if the requested skill is unknown; logs a warning.
 */
export function compose(params: ComposeParams): ComposeResult {
  const parts: string[] = [];

  const master = readMasterCommand();
  if (master) parts.push(master);

  // Resolve skill — fall back to explore if unknown.
  let skillName = params.skill;
  let skillMeta = loadSkill(skillName);
  if (!skillMeta) {
    if (skillName !== FALLBACK_SKILL) {
      console.warn(`[mode-prompts] Unknown skill "${skillName}", falling back to "${FALLBACK_SKILL}".`);
      skillName = FALLBACK_SKILL;
      skillMeta = loadSkill(skillName);
    }
  }

  if (skillMeta?.body) {
    parts.push(`## Active skill: ${skillMeta.displayName || skillName}\n\n${skillMeta.body}`);
  }

  parts.push(`## Active game\n\n${params.game}`);

  parts.push(FIELD_CHIP_TOKEN_GUIDANCE);

  if (params.focus) {
    const focusBlock = renderFocusPreamble(params.focus);
    if (focusBlock) parts.push(focusBlock);
  }

  if (params.contextPreamble) {
    parts.push(`## Context\n\n${params.contextPreamble}`);
  }

  return {
    systemPrompt: parts.join('\n\n---\n\n'),
    allowedToolNames: skillMeta?.allowedTools ?? [],
  };
}

/**
 * Field-chip token spec (phase-02). Whenever the assistant references a
 * concrete cube field, it should emit it as `{{field:<cube>.<member>}}`
 * so the UI can render an inline chip linking to the schema cartographer.
 */
const FIELD_CHIP_TOKEN_GUIDANCE = `## Field chip token

When referencing a specific cube field (measure / dimension / segment),
emit it as a locked token so the UI can render it as a clickable chip:

    {{field:<cube>.<member>}}

Examples:
- "Daily revenue is computed from {{field:recharge.revenue_vnd}}."
- "Filter by {{field:players.country}} = 'VN'."

Use the token in body text only; tool-result payloads should keep raw
identifiers. Do not invent fields — only emit tokens for fields that
exist in the active game's catalog.`;

/** Reset the master command cache (test helper — not for production use). */
export function _resetMasterCache(): void {
  masterCommandCache = null;
}
