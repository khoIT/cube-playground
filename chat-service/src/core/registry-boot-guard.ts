/**
 * Boot-time validation: every skill's `allowed_tools[]` entry must refer to a
 * tool that exists in the tool registry. A typo in SKILL.md today silently
 * degrades to "skill falls back to explore" — the model loses access to the
 * tool it was supposed to call and no error surfaces. We'd rather crash at
 * boot with a clear message than ship that misconfiguration to prod.
 *
 * The validator is read-only:
 *   - reads each SKILL.md under `.claude/skills/`
 *   - intersects `allowed_tools[]` with the live registry tool names
 *   - throws on the first mismatch citing skill name + offending tool
 *
 * Wire into `index.ts:start()` before `fastify.listen()`.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSkillLoader } from './skill-loader.js';
import { TOOL_NAMES } from '../tools/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILLS_DIR = resolve(__dirname, '../../.claude/skills');

export class SkillRegistryMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillRegistryMismatchError';
  }
}

export interface ValidateSkillRegistryOptions {
  /** Override skills directory — used by tests. */
  skillsDir?: string;
  /** Override registry tool list — used by tests. */
  registryToolNames?: readonly string[];
}

/**
 * Verify every skill's allowed_tools[] references a registered tool. Throws
 * SkillRegistryMismatchError on the first mismatch. Returns the count of
 * skills validated so callers can log it.
 */
export function validateSkillRegistry(
  options: ValidateSkillRegistryOptions = {},
): { skillsChecked: number; toolsChecked: number } {
  const skillsDir = options.skillsDir ?? DEFAULT_SKILLS_DIR;
  const registeredNames = new Set(options.registryToolNames ?? TOOL_NAMES);

  // TTL of 0 — always read fresh; this runs once at boot.
  const loader = createSkillLoader(skillsDir, 0);
  const skillNames = loader.list();

  let toolsChecked = 0;

  for (const skillName of skillNames) {
    const skill = loader.load(skillName);
    if (!skill) {
      // Empty directory or malformed SKILL.md — surface explicitly.
      throw new SkillRegistryMismatchError(
        `Skill '${skillName}' has no readable SKILL.md at ${skillsDir}/${skillName}/SKILL.md`,
      );
    }

    for (const toolName of skill.allowedTools) {
      toolsChecked += 1;
      if (!registeredNames.has(toolName)) {
        throw new SkillRegistryMismatchError(
          `Skill '${skillName}' references unknown tool '${toolName}' in allowed_tools. ` +
            `Registered tools: ${[...registeredNames].sort().join(', ')}. ` +
            `File: ${skillsDir}/${skillName}/SKILL.md`,
        );
      }
    }
  }

  return { skillsChecked: skillNames.length, toolsChecked };
}
