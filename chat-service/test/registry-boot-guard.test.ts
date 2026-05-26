/**
 * Tests for validateSkillRegistry — passes on a valid skill set, throws with
 * a clear message on the first unknown tool reference.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateSkillRegistry,
  SkillRegistryMismatchError,
} from '../src/core/registry-boot-guard.js';

function writeSkill(baseDir: string, name: string, content: string): void {
  const dir = join(baseDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8');
}

const VALID_EXPLORE = `---
name: explore
display_name: Explore
description: Exploration skill.
trigger_keywords:
  - show
allowed_tools:
  - get_cube_meta
  - preview_cube_query
---

body.
`;

const VALID_METRIC = `---
name: metric_explain
display_name: Metric
description: Metric explainer.
trigger_keywords:
  - what is
allowed_tools:
  - get_cube_meta
  - get_business_metric
---

body.
`;

const TYPO_SKILL = `---
name: bad
display_name: Bad
description: Has a typo.
trigger_keywords:
  - x
allowed_tools:
  - get_cube_meta
  - preview_cube_querry
---

body.
`;

const REGISTRY = [
  'get_cube_meta',
  'preview_cube_query',
  'get_business_metric',
  'emit_chart',
] as const;

describe('validateSkillRegistry', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'reg-boot-guard-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('passes when every skill references registered tools', () => {
    writeSkill(tmp, 'explore', VALID_EXPLORE);
    writeSkill(tmp, 'metric_explain', VALID_METRIC);

    const result = validateSkillRegistry({
      skillsDir: tmp,
      registryToolNames: REGISTRY,
    });

    expect(result.skillsChecked).toBe(2);
    expect(result.toolsChecked).toBe(4);
  });

  it('throws when a skill references an unknown tool', () => {
    writeSkill(tmp, 'bad', TYPO_SKILL);

    expect(() =>
      validateSkillRegistry({ skillsDir: tmp, registryToolNames: REGISTRY }),
    ).toThrow(SkillRegistryMismatchError);
  });

  it('error message names the skill, tool, and SKILL.md path', () => {
    writeSkill(tmp, 'bad', TYPO_SKILL);

    try {
      validateSkillRegistry({ skillsDir: tmp, registryToolNames: REGISTRY });
      throw new Error('Expected throw, got none');
    } catch (err) {
      const e = err as Error;
      expect(e).toBeInstanceOf(SkillRegistryMismatchError);
      expect(e.message).toContain("Skill 'bad'");
      expect(e.message).toContain("'preview_cube_querry'");
      expect(e.message).toContain('SKILL.md');
    }
  });

  it('throws when a skill directory has no SKILL.md', () => {
    mkdirSync(join(tmp, 'empty'), { recursive: true });

    expect(() =>
      validateSkillRegistry({ skillsDir: tmp, registryToolNames: REGISTRY }),
    ).toThrow(SkillRegistryMismatchError);
  });

  it('accepts a skill with an empty allowed_tools list', () => {
    writeSkill(
      tmp,
      'free',
      `---\nname: free\ndisplay_name: Free\ndescription: open skill.\ntrigger_keywords: []\nallowed_tools: []\n---\n\nbody.\n`,
    );

    const result = validateSkillRegistry({
      skillsDir: tmp,
      registryToolNames: REGISTRY,
    });
    expect(result.skillsChecked).toBe(1);
    expect(result.toolsChecked).toBe(0);
  });

  it('returns zero when no skills exist (no-op boot)', () => {
    const result = validateSkillRegistry({
      skillsDir: tmp,
      registryToolNames: REGISTRY,
    });
    expect(result.skillsChecked).toBe(0);
    expect(result.toolsChecked).toBe(0);
  });
});
