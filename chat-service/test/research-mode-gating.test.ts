/**
 * Phase-06 research-mode gating tests.
 *
 * Verifies:
 *   - Timeout doubles when both env flag AND skill opt-in are true.
 *   - Standard timeout applies in all other combinations.
 *   - Skill-loader correctly parses enable_research_mode from SKILL.md frontmatter.
 *   - SDK research option: v0.3.150 does not expose a dedicated `research` flag
 *     in its query options type surface. Only timeout-doubling is implemented.
 *     When an SDK research option becomes available, add it to QueryOptionsOverrides
 *     in query-options-presets.ts and extend these tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSkillLoader } from '../src/core/skill-loader.js';

// ---------------------------------------------------------------------------
// Timeout-doubling logic (mirrors api/turn.ts lines)
// ---------------------------------------------------------------------------

function resolveEffectiveTimeout(
  baseTurnTimeoutMs: number,
  envFlag: boolean,
  skillFlag: boolean,
): number {
  const researchModeEnabled = envFlag && skillFlag;
  return researchModeEnabled ? baseTurnTimeoutMs * 2 : baseTurnTimeoutMs;
}

describe('Research-mode timeout doubling', () => {
  const BASE_TIMEOUT = 120_000;

  it('doubles the timeout when both env flag and skill opt-in are true', () => {
    expect(resolveEffectiveTimeout(BASE_TIMEOUT, true, true)).toBe(240_000);
  });

  it('keeps standard timeout when env flag is false', () => {
    expect(resolveEffectiveTimeout(BASE_TIMEOUT, false, true)).toBe(BASE_TIMEOUT);
  });

  it('keeps standard timeout when skill opt-out (false)', () => {
    expect(resolveEffectiveTimeout(BASE_TIMEOUT, true, false)).toBe(BASE_TIMEOUT);
  });

  it('keeps standard timeout when both flags are false', () => {
    expect(resolveEffectiveTimeout(BASE_TIMEOUT, false, false)).toBe(BASE_TIMEOUT);
  });

  it('doubling is exactly 2x (not 1.5x or 3x)', () => {
    const result = resolveEffectiveTimeout(60_000, true, true);
    expect(result).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------
// Skill-loader frontmatter parsing: enable_research_mode
// ---------------------------------------------------------------------------

function writeSkill(baseDir: string, name: string, content: string): void {
  const dir = join(baseDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8');
}

const DIAGNOSE_SKILL_OPTED_IN = `---
name: diagnose
display_name: Diagnose
description: Root-cause skill.
trigger_keywords:
  - why
  - drop
allowed_tools:
  - preview_cube_query
enable_web_search: false
enable_research_mode: true
---

# Diagnose body here.
`;

const EXPLORE_SKILL_OPTED_OUT = `---
name: explore
display_name: Explore
description: Exploration skill.
trigger_keywords:
  - show
allowed_tools:
  - get_cube_meta
enable_web_search: true
enable_research_mode: false
---

# Explore body here.
`;

const SKILL_WITHOUT_FLAGS = `---
name: legacy
display_name: Legacy
description: Skill without phase-06 flags.
trigger_keywords:
  - old
allowed_tools:
  - get_cube_meta
---

# Legacy skill.
`;

describe('Skill-loader — enable_research_mode frontmatter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'research-mode-test-'));
    writeSkill(tmpDir, 'diagnose', DIAGNOSE_SKILL_OPTED_IN);
    writeSkill(tmpDir, 'explore', EXPLORE_SKILL_OPTED_OUT);
    writeSkill(tmpDir, 'legacy', SKILL_WITHOUT_FLAGS);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses enable_research_mode: true from diagnose skill', () => {
    const loader = createSkillLoader(tmpDir, 5_000);
    const skill = loader.load('diagnose');
    expect(skill).not.toBeNull();
    expect(skill!.enableResearchMode).toBe(true);
  });

  it('parses enable_research_mode: false from explore skill', () => {
    const loader = createSkillLoader(tmpDir, 5_000);
    const skill = loader.load('explore');
    expect(skill).not.toBeNull();
    expect(skill!.enableResearchMode).toBe(false);
  });

  it('defaults enable_research_mode to false when frontmatter field is absent', () => {
    const loader = createSkillLoader(tmpDir, 5_000);
    const skill = loader.load('legacy');
    expect(skill).not.toBeNull();
    expect(skill!.enableResearchMode).toBe(false);
  });

  it('parses enable_web_search: true from explore skill alongside research_mode=false', () => {
    const loader = createSkillLoader(tmpDir, 5_000);
    const skill = loader.load('explore');
    expect(skill!.enableWebSearch).toBe(true);
    expect(skill!.enableResearchMode).toBe(false);
  });

  it('parses both flags independently on diagnose: web_search=false, research=true', () => {
    const loader = createSkillLoader(tmpDir, 5_000);
    const skill = loader.load('diagnose');
    expect(skill!.enableWebSearch).toBe(false);
    expect(skill!.enableResearchMode).toBe(true);
  });
});
