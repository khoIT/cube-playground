/**
 * Walks .claude/skills/*\/SKILL.md, parses YAML frontmatter via gray-matter,
 * and caches results with a TTL configurable via SKILL_LOADER_TTL_MS env var.
 *
 * The internal cache uses a plain Map + timestamp so TTL expiry is controllable
 * in tests via an injected clock function (nowFn).
 */

import matter from 'gray-matter';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Skills live at chat-service/.claude/skills/<name>/SKILL.md
const DEFAULT_SKILLS_DIR = resolve(__dirname, '../../.claude/skills');

export interface SkillMeta {
  name: string;
  displayName: string;
  description: string;
  triggerKeywords: string[];
  allowedTools: string[];
  body: string; // markdown body after frontmatter
  /** Phase 06 — opt in to WebSearch tool for this skill. Default false. */
  enableWebSearch: boolean;
  /** Phase 06 — opt in to research mode (doubled timeout) for this skill. Default false. */
  enableResearchMode: boolean;
}

interface CacheEntry {
  skill: SkillMeta;
  loadedAt: number;
}

function parseSkillFile(filePath: string): SkillMeta {
  const raw = readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  return {
    name: String(data['name'] ?? ''),
    displayName: String(data['display_name'] ?? data['name'] ?? ''),
    description: String(data['description'] ?? ''),
    triggerKeywords: Array.isArray(data['trigger_keywords']) ? data['trigger_keywords'] : [],
    allowedTools: Array.isArray(data['allowed_tools']) ? data['allowed_tools'] : [],
    body: content.trim(),
    enableWebSearch: data['enable_web_search'] === true,
    enableResearchMode: data['enable_research_mode'] === true,
  };
}

/**
 * Creates an isolated skill loader bound to a specific skills directory and TTL.
 *
 * @param skillsDir - absolute path to the directory containing skill sub-directories.
 * @param ttlMs     - cache TTL in milliseconds.
 * @param nowFn     - clock function; defaults to Date.now. Override in tests for determinism.
 */
export function createSkillLoader(
  skillsDir: string,
  ttlMs: number,
  nowFn: () => number = Date.now,
) {
  const cache = new Map<string, CacheEntry>();

  function load(name: string): SkillMeta | null {
    const entry = cache.get(name);
    if (entry && nowFn() - entry.loadedAt < ttlMs) {
      return entry.skill;
    }

    const filePath = resolve(skillsDir, name, 'SKILL.md');
    if (!existsSync(filePath)) return null;

    try {
      const skill = parseSkillFile(filePath);
      cache.set(name, { skill, loadedAt: nowFn() });
      return skill;
    } catch (err) {
      console.warn(
        `[skill-loader] Failed to parse skill "${name}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  function list(): string[] {
    if (!existsSync(skillsDir)) return [];
    try {
      return readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
  }

  function invalidate(name: string): void {
    cache.delete(name);
  }

  return { load, list, invalidate };
}

// ---------------------------------------------------------------------------
// Module-level singleton used by the rest of the service
// ---------------------------------------------------------------------------

const defaultLoader = createSkillLoader(DEFAULT_SKILLS_DIR, config.skillLoaderTtlMs);

/** Load a skill by name. Returns null if not found or malformed. Cached with TTL. */
export function loadSkill(name: string): SkillMeta | null {
  return defaultLoader.load(name);
}

/** Return all available skill names by scanning the skills directory. */
export function listSkillNames(): string[] {
  return defaultLoader.list();
}

/** Invalidate the cache for a skill (useful for hot-reload in dev). */
export function invalidateSkill(name: string): void {
  defaultLoader.invalidate(name);
}
