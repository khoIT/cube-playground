/**
 * Compose the system prompt for a turn by concatenating:
 *   1. Master command body (cube-playground.md)
 *   2. Active skill body (SKILL.md)
 *   3. Active game context line
 *   4. Optional context preamble (page URL, selected blocks, etc.)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkill } from './skill-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MASTER_CMD_PATH = resolve(__dirname, '../../.claude/commands/cube-playground.md');

function readMasterCommand(): string {
  if (!existsSync(MASTER_CMD_PATH)) return '';
  return readFileSync(MASTER_CMD_PATH, 'utf-8').trim();
}

export interface ComposeParams {
  skill: string;
  game: string;
  contextPreamble?: string;
}

/**
 * Build the full system prompt for a turn.
 * Falls back gracefully if the master command or skill file is missing.
 */
export function compose(params: ComposeParams): string {
  const parts: string[] = [];

  const master = readMasterCommand();
  if (master) parts.push(master);

  const skillMeta = loadSkill(params.skill);
  if (skillMeta?.body) {
    parts.push(`## Active skill: ${skillMeta.displayName || params.skill}\n\n${skillMeta.body}`);
  }

  parts.push(`## Active game\n\n${params.game}`);

  if (params.contextPreamble) {
    parts.push(`## Context\n\n${params.contextPreamble}`);
  }

  return parts.join('\n\n---\n\n');
}
