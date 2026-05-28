/**
 * Single source of truth for `workspaces.config.json` (the Cube workspace registry).
 *
 * Workspaces are SERVER-SIDE only. Clients never send raw Cube URLs — they send a
 * workspace id via `x-cube-workspace`, and the server resolves the id → URL/auth.
 * This is the SSRF guard: an unknown id 400s, never an outbound request.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

export type WorkspaceAuthMode = 'none' | 'minted' | 'env-token';
export type WorkspaceGameModel = 'game_id' | 'prefix';

export interface WorkspaceDef {
  id: string;
  label: string;
  cubeApiUrl: string;
  authMode: WorkspaceAuthMode;
  gameModel: WorkspaceGameModel;
  /** When gameModel='prefix': maps gds.config game id → Cube cube-name prefix. */
  gamePrefixMap?: Record<string, string>;
  /**
   * Optional RBAC gate: only roles in this list can list, switch into, or
   * mutate artifacts in this workspace. Absent / empty = no role restriction
   * (any authenticated role can use it — viewer included).
   */
  allowedRoles?: Array<'viewer' | 'editor' | 'admin'>;
}

export interface WorkspacesConfig {
  default: string;
  workspaces: WorkspaceDef[];
}

const FALLBACK: WorkspacesConfig = {
  default: 'local',
  workspaces: [
    {
      id: 'local',
      label: 'Local dev',
      cubeApiUrl: 'http://localhost:4000',
      authMode: 'minted',
      gameModel: 'game_id',
    },
  ],
};

const CONFIG_FILENAME = 'workspaces.config.json';

let cached: WorkspacesConfig | null = null;

function resolveConfigPath(): string | null {
  const envPath = process.env.WORKSPACES_CONFIG_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const cwdPath = join(process.cwd(), CONFIG_FILENAME);
  if (existsSync(cwdPath)) return cwdPath;

  let dir = dirname(fileURLToPath(import.meta.url));
  const { root } = parse(dir);
  while (true) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

function validate(parsed: unknown): parsed is WorkspacesConfig {
  if (!parsed || typeof parsed !== 'object') return false;
  const cfg = parsed as Partial<WorkspacesConfig>;
  if (typeof cfg.default !== 'string') return false;
  if (!Array.isArray(cfg.workspaces) || cfg.workspaces.length === 0) return false;
  for (const w of cfg.workspaces) {
    if (!w || typeof w.id !== 'string' || typeof w.cubeApiUrl !== 'string') return false;
    if (w.authMode !== 'none' && w.authMode !== 'minted' && w.authMode !== 'env-token') return false;
    if (w.gameModel !== 'game_id' && w.gameModel !== 'prefix') return false;
  }
  return cfg.workspaces.some((w) => w.id === cfg.default);
}

export function loadWorkspacesConfig(): WorkspacesConfig {
  if (cached) return cached;
  const path = resolveConfigPath();
  if (!path) {
    cached = FALLBACK;
    return cached;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    cached = validate(parsed) ? parsed : FALLBACK;
  } catch {
    cached = FALLBACK;
  }
  return cached;
}

/**
 * Resolve a workspace by id; falls back to the default when id is undefined or empty.
 * Returns null for an unknown id (caller must 400).
 */
export function resolveWorkspace(id?: string | null): WorkspaceDef | null {
  const cfg = loadWorkspacesConfig();
  const wanted = (id?.trim() ?? '') || cfg.default;
  return cfg.workspaces.find((w) => w.id === wanted) ?? null;
}

/** Default workspace. */
export function getDefaultWorkspace(): WorkspaceDef {
  const cfg = loadWorkspacesConfig();
  const d = cfg.workspaces.find((w) => w.id === cfg.default);
  // Validation guarantees default exists; fall through to first as a hard guard.
  return d ?? cfg.workspaces[0];
}

/** Secret-free projection for the public `/api/workspaces` route. */
export function listWorkspacesPublic(): Array<
  Pick<WorkspaceDef, 'id' | 'label' | 'gameModel' | 'authMode' | 'gamePrefixMap' | 'allowedRoles'> & {
    isDefault: boolean;
  }
> {
  const cfg = loadWorkspacesConfig();
  return cfg.workspaces.map((w) => ({
    id: w.id,
    label: w.label,
    gameModel: w.gameModel,
    authMode: w.authMode,
    gamePrefixMap: w.gamePrefixMap,
    allowedRoles: w.allowedRoles,
    isDefault: w.id === cfg.default,
  }));
}

/** Predicate: does the given role have access to a workspace? */
export function workspaceAllowsRole(
  workspace: Pick<WorkspaceDef, 'allowedRoles'>,
  role: 'viewer' | 'editor' | 'admin',
): boolean {
  if (!workspace.allowedRoles || workspace.allowedRoles.length === 0) return true;
  return workspace.allowedRoles.includes(role);
}

/** Test-only cache reset. */
export function __resetWorkspacesConfigCache(): void {
  cached = null;
}
