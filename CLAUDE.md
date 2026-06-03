# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Role & Responsibilities

Your role is to analyze user requirements, delegate tasks to appropriate sub-agents, and ensure cohesive delivery of features that meet specifications and architectural standards.

## Workflows

- Primary workflow: `$HOME/.claude/rules/primary-workflow.md`
- Development rules: `$HOME/.claude/rules/development-rules.md`
- Orchestration protocols: `$HOME/.claude/rules/orchestration-protocol.md`
- Documentation management: `$HOME/.claude/rules/documentation-management.md`
- And other workflows: `$HOME/.claude/rules/*`

**IMPORTANT:** Analyze the skills catalog and activate the skills that are needed for the task during the process.
**IMPORTANT:** DO NOT modify skills in `~/.claude/skills` directory directly. **MUST** modify skills in this current working directory. Unless you are asked to do so.
**IMPORTANT:** You must follow strictly the development rules in `$HOME/.claude/rules/development-rules.md` file.
**IMPORTANT:** Before you plan or proceed any implementation, always read the `./README.md` file first to get context.
**IMPORTANT:** Read `./docs/lessons-learned.md` before debugging a non-trivial bug or shipping any change that touches Cube YAMLs, cache layers, test setup, or UI surfaces — each entry is a bug shape with a signal so you can short-circuit similar failures instead of rediscovering them. Add a new entry there when you fix a class of bug that future-you would benefit from spotting earlier.
**IMPORTANT:** Sacrifice grammar for the sake of concision when writing reports.
**IMPORTANT:** In reports, list any unresolved questions at the end, if any.

## Design System (MANDATORY for any UI work)

Before adding or changing any page, component, or visual surface, read `./docs/design-guidelines.md`. The cube-playground UI is one coherent system — new surfaces must look like they belong with `Dashboards`, `Segments`, `Catalog`, and the LiveOps cohort grid.

**Non-negotiable rules:**

1. **Use design tokens, not raw values.** Every color, radius, shadow, font, and key spacing value lives in `src/theme/tokens.css`. Reference them as CSS variables: `var(--text-primary)`, `var(--border-card)`, `var(--bg-card)`, `var(--brand)`, `var(--radius-md)`, `var(--font-sans)`, `var(--positive)`, `var(--destructive-soft)`, etc. Do NOT inline hex codes or px-only fonts when a token exists.
2. **One font stack: `var(--font-sans)` (Inter).** Do not introduce display, editorial, serif, or bespoke font stacks on existing surfaces. The editorial serif tokens are reserved for explicitly editorial contexts and must NOT leak into general dashboards.
3. **Page-header pattern is fixed.** Top-level pages use: `padding: '24px 32px'`, `maxWidth` (800 for lists / 1200–1400 for grids), centered `margin: '0 auto'`, an icon + 20px / 700 sans-serif title, optional small uppercase eyebrow above. Mirror the pattern in `src/pages/Dashboards/index.tsx` and `src/pages/Liveops/cohort/index.tsx` — do not invent new header shapes.
4. **Semantic tokens for status colors.** Use `--success-soft / --success-ink`, `--warning-soft / --warning-ink`, `--destructive-soft / --destructive-ink`, `--info-soft / --info-ink`, `--muted-soft / --muted-ink`. These already adapt for dark mode; raw `#fee2e2` etc. do not.
5. **No new bespoke spacing constants.** Reuse the spacing scale visible across existing pages (4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 / 32 / 48). Anything outside this is a smell — justify it or pick from the scale.
6. **Cross-check before shipping.** Pull up an adjacent existing page (Dashboards, Cohort, Segments) and visually compare typography, padding, border-radius, and color. Drift = bug.

**When in doubt:** copy from the closest existing well-formed page in `src/pages/` rather than re-deriving styles.

## Git

**DO NOT** use `chore` and `docs` in commit messages of file changes in `.claude` directory.

## Hook Response Protocol

### Privacy Block Hook (`@@PRIVACY_PROMPT@@`)

When a tool call is blocked by the privacy-block hook, the output contains a JSON marker between `@@PRIVACY_PROMPT_START@@` and `@@PRIVACY_PROMPT_END@@`. **You MUST use the `AskUserQuestion` tool** to get proper user approval.

**Required Flow:**

1. Parse the JSON from the hook output
2. Use `AskUserQuestion` with the question data from the JSON
3. Based on user's selection:
   - **"Yes, approve access"** → Use `bash cat "filepath"` to read the file (bash is auto-approved)
   - **"No, skip this file"** → Continue without accessing the file

**Example AskUserQuestion call:**
```json
{
  "questions": [{
    "question": "I need to read \".env\" which may contain sensitive data. Do you approve?",
    "header": "File Access",
    "options": [
      { "label": "Yes, approve access", "description": "Allow reading .env this time" },
      { "label": "No, skip this file", "description": "Continue without accessing this file" }
    ],
    "multiSelect": false
  }]
}
```

**IMPORTANT:** Always ask the user via `AskUserQuestion` first. Never try to work around the privacy block without explicit user approval.

## Python Scripts (Skills)

When running Python scripts from `.claude/skills/`, use the venv Python interpreter:
- **Linux/macOS:** `.claude/skills/.venv/bin/python3 scripts/xxx.py`
- **Windows:** `.claude\skills\.venv\Scripts\python.exe scripts\xxx.py`

This ensures packages installed by `install.sh` (google-genai, pypdf, etc.) are available.

**IMPORTANT:** When scripts of skills failed, don't stop, try to fix them directly.

## [IMPORTANT] Consider Modularization
- If a code file exceeds 200 lines of code, consider modularizing it
- Check existing modules before creating new
- Analyze logical separation boundaries (functions, classes, concerns)
- Use kebab-case naming with long descriptive names, it's fine if the file name is long because this ensures file names are self-documenting for LLM tools (Grep, Glob, Search)
- Write descriptive code comments
- After modularization, continue with main task
- When not to modularize: Markdown files, plain text files, bash scripts, configuration files, environment variables files, etc.

## Documentation Management

We keep all important docs in `./docs` folder and keep updating them, structure like below:

```
./docs
├── project-overview-pdr.md
├── code-standards.md
├── codebase-summary.md
├── design-guidelines.md
├── deployment-guide.md
├── system-architecture.md
└── project-roadmap.md
```

**IMPORTANT:** *MUST READ* and *MUST COMPLY* all *INSTRUCTIONS* in project `./CLAUDE.md`, especially *WORKFLOWS* section is *CRITICALLY IMPORTANT*, this rule is *MANDATORY. NON-NEGOTIABLE. NO EXCEPTIONS. MUST REMEMBER AT ALL TIMES!!!*
