/**
 * Walks .claude/skills/*\/SKILL.md, parses YAML frontmatter via gray-matter,
 * and caches results in an LRU with a 5-second TTL in dev.
 */

import matter from 'gray-matter';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LRUCache } from 'lru-cache';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Skills live at chat-service/.claude/skills/<name>/SKILL.md
const SKILLS_DIR = resolve(__dirname, '../../.claude/skills');

const TTL_MS = process.env['NODE_ENV'] === 'production' ? 60_000 : 5_000;

export interface SkillMeta {
  name: string;
  displayName: string;
  description: string;
  triggerKeywords: string[];
  allowedTools: string[];
  body: string; // markdown body after frontmatter
}

const cache = new LRUCache<string, SkillMeta>({
  max: 20,
  ttl: TTL_MS,
});

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
  };
}

/** Load a skill by name. Returns null if not found. Cached with TTL. */
export function loadSkill(name: string): SkillMeta | null {
  const cached = cache.get(name);
  if (cached) return cached;

  const filePath = resolve(SKILLS_DIR, name, 'SKILL.md');
  if (!existsSync(filePath)) return null;

  const skill = parseSkillFile(filePath);
  cache.set(name, skill);
  return skill;
}

/** Return all available skill names by scanning the skills directory. */
export function listSkillNames(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  try {
    return readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Invalidate the cache for a skill (useful for hot-reload in dev). */
export function invalidateSkill(name: string): void {
  cache.delete(name);
}
