/**
 * Tests for skill-loader: frontmatter parsing, LRU TTL cache expiry,
 * and graceful handling of malformed SKILL.md files.
 *
 * Uses createSkillLoader() with a custom temp directory so tests are
 * fully isolated from the real .claude/skills directory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSkillLoader } from '../src/core/skill-loader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeSkill(baseDir: string, name: string, content: string): void {
  const dir = join(baseDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8');
}

const VALID_EXPLORE = `---
name: explore
display_name: Explore
description: Data exploration skill.
trigger_keywords:
  - show
  - chart
allowed_tools:
  - get_cube_meta
  - preview_cube_query
---

# Explore Skill

Step 1: do something.
`;

const VALID_METRIC_EXPLAIN = `---
name: metric_explain
display_name: Explain Metric
description: Explain a business metric in plain English.
trigger_keywords:
  - what is
  - formula
allowed_tools:
  - get_cube_meta
  - list_business_metrics
  - get_business_metric
  - emit_query_artifact
---

# Explain Metric Skill

Step 1: search metrics.
`;

// Malformed: YAML that throws during parse (invalid type coercion triggers graceful skip)
// gray-matter won't throw on most YAML — we simulate a read error by making the file unreadable.
// Instead, test with a frontmatter whose allowed_tools is a non-array scalar.
const MALFORMED_FRONTMATTER = `---
name: bad_skill
allowed_tools: not-an-array
---

Body here.
`;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('createSkillLoader — frontmatter parsing', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skill-loader-test-'));
    writeSkill(tmpDir, 'explore', VALID_EXPLORE);
    writeSkill(tmpDir, 'metric_explain', VALID_METRIC_EXPLAIN);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses explore frontmatter correctly', () => {
    const loader = createSkillLoader(tmpDir, 5_000);
    const skill = loader.load('explore');

    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('explore');
    expect(skill!.displayName).toBe('Explore');
    expect(skill!.description).toBe('Data exploration skill.');
    expect(skill!.triggerKeywords).toEqual(['show', 'chart']);
    expect(skill!.allowedTools).toEqual(['get_cube_meta', 'preview_cube_query']);
    expect(skill!.body).toContain('Step 1: do something.');
  });

  it('parses metric_explain frontmatter correctly', () => {
    const loader = createSkillLoader(tmpDir, 5_000);
    const skill = loader.load('metric_explain');

    expect(skill).not.toBeNull();
    expect(skill!.allowedTools).toHaveLength(4);
    expect(skill!.allowedTools).toContain('emit_query_artifact');
  });

  it('returns null for a non-existent skill', () => {
    const loader = createSkillLoader(tmpDir, 5_000);
    expect(loader.load('nonexistent')).toBeNull();
  });

  it('lists all skill directory names', () => {
    const loader = createSkillLoader(tmpDir, 5_000);
    const names = loader.list();
    expect(names).toContain('explore');
    expect(names).toContain('metric_explain');
  });
});

describe('createSkillLoader — TTL cache expiry (injected clock)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skill-loader-ttl-'));
    writeSkill(tmpDir, 'explore', VALID_EXPLORE);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serves from cache on second call within TTL', () => {
    let fakeNow = 0;
    const loader = createSkillLoader(tmpDir, 10_000, () => fakeNow);

    const first = loader.load('explore');
    // Overwrite disk content — should NOT be visible within TTL
    writeSkill(tmpDir, 'explore', VALID_EXPLORE.replace('Data exploration skill.', 'Updated description'));

    fakeNow = 5_000; // still within 10 s TTL
    const second = loader.load('explore');
    expect(second!.description).toBe('Data exploration skill.'); // still cached
    expect(second).toBe(first); // same object reference
  });

  it('reads from disk again after TTL expires', () => {
    const TTL = 5_000;
    let fakeNow = 0;
    const loader = createSkillLoader(tmpDir, TTL, () => fakeNow);

    loader.load('explore'); // prime cache at t=0
    // Overwrite disk content
    writeSkill(tmpDir, 'explore', VALID_EXPLORE.replace('Data exploration skill.', 'After TTL description'));

    fakeNow = TTL + 1; // advance past TTL
    const reloaded = loader.load('explore');
    expect(reloaded!.description).toBe('After TTL description');
  });

  it('invalidate() forces a fresh read before TTL expires', () => {
    let fakeNow = 0;
    const loader = createSkillLoader(tmpDir, 60_000, () => fakeNow);

    loader.load('explore'); // prime cache
    writeSkill(tmpDir, 'explore', VALID_EXPLORE.replace('Data exploration skill.', 'Invalidated description'));

    loader.invalidate('explore');
    const reloaded = loader.load('explore');
    expect(reloaded!.description).toBe('Invalidated description');
  });
});

describe('createSkillLoader — malformed frontmatter', () => {
  let tmpDir: string;
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skill-loader-bad-'));
    writeSkill(tmpDir, 'explore', VALID_EXPLORE);
    writeSkill(tmpDir, 'bad_skill', MALFORMED_FRONTMATTER);
  });

  afterEach(() => {
    warnSpy.mockClear();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns skill with empty allowedTools when allowed_tools is a scalar (not array)', () => {
    const loader = createSkillLoader(tmpDir, 5_000);
    // gray-matter parses it without throwing; the scalar falls through to []
    const skill = loader.load('bad_skill');
    // Should load but allowedTools should be empty (non-array coerced to [])
    expect(skill).not.toBeNull();
    expect(skill!.allowedTools).toEqual([]);
  });

  it('still loads valid skills when another skill directory exists', () => {
    const loader = createSkillLoader(tmpDir, 5_000);
    const explore = loader.load('explore');
    expect(explore).not.toBeNull();
    expect(explore!.name).toBe('explore');
  });

  it('returns null for a skill whose SKILL.md cannot be read', () => {
    // Create a directory named 'broken' with no SKILL.md inside
    mkdirSync(join(tmpDir, 'broken'), { recursive: true });
    const loader = createSkillLoader(tmpDir, 5_000);
    expect(loader.load('broken')).toBeNull();
  });
});
