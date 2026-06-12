/**
 * Docker Engine API client for container control (inspect / remove / create /
 * start) over the Unix socket — the write-side sibling of docker-log-reader.ts.
 *
 * Exists so the pre-agg build trigger can recreate the refresh worker with a
 * modified environment from INSIDE a container (prod gateway) where no docker
 * CLI or compose binary exists — only the socket mount. Recreation preserves
 * the container's image, host config (mounts, restart policy, healthcheck) and
 * network aliases, so the result is byte-for-byte what `docker compose up
 * --force-recreate` with env overrides would produce.
 *
 * Every failure throws DockerControlError so callers can degrade without
 * crashing the gateway.
 */

import * as http from 'node:http';

const DOCKER_SOCKET = process.env.PREAGG_DOCKER_SOCKET || '/var/run/docker.sock';

export class DockerControlError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DockerControlError';
  }
}

/** The subset of `GET /containers/{id}/json` this module reads and replays. */
export interface ContainerInspect {
  Id: string;
  Name: string;
  Config: {
    Image: string;
    Env: string[];
    Labels: Record<string, string>;
    [key: string]: unknown;
  };
  HostConfig: Record<string, unknown>;
  NetworkSettings: {
    Networks: Record<string, { Aliases?: string[] | null }>;
  };
}

// ---------------------------------------------------------------------------
// HTTP-over-socket helper (JSON in / JSON or empty out)
// ---------------------------------------------------------------------------

function socketRequest(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          if (text) {
            try { json = JSON.parse(text); } catch { json = text; }
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
        res.on('error', (err) => reject(new DockerControlError('Response stream error', err)));
      },
    );
    req.on('error', (err: NodeJS.ErrnoException) =>
      reject(new DockerControlError(`Docker socket unavailable at ${DOCKER_SOCKET}: ${err.code ?? err.message}`, err)),
    );
    if (payload) req.write(payload);
    req.end();
  });
}

function errMessage(json: unknown): string {
  if (json && typeof json === 'object' && 'message' in json) return String((json as { message: unknown }).message);
  return String(json ?? '');
}

// ---------------------------------------------------------------------------
// Container operations
// ---------------------------------------------------------------------------

export async function inspectContainer(name: string): Promise<ContainerInspect> {
  const { status, json } = await socketRequest('GET', `/containers/${encodeURIComponent(name)}/json`);
  if (status !== 200) throw new DockerControlError(`inspect ${name} → ${status}: ${errMessage(json)}`);
  return json as ContainerInspect;
}

async function removeContainer(name: string): Promise<void> {
  const { status, json } = await socketRequest('DELETE', `/containers/${encodeURIComponent(name)}?force=true`);
  // 404 = already gone — fine for our recreate flow.
  if (status !== 204 && status !== 404) throw new DockerControlError(`remove ${name} → ${status}: ${errMessage(json)}`);
}

async function createContainer(name: string, body: Record<string, unknown>): Promise<string> {
  // The just-removed name can linger for a moment — retry briefly on conflict.
  for (let attempt = 0; ; attempt++) {
    const { status, json } = await socketRequest('POST', `/containers/create?name=${encodeURIComponent(name)}`, body);
    if (status === 201) return String((json as { Id: string }).Id);
    if (status === 409 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    throw new DockerControlError(`create ${name} → ${status}: ${errMessage(json)}`);
  }
}

async function startContainer(id: string): Promise<void> {
  const { status, json } = await socketRequest('POST', `/containers/${encodeURIComponent(id)}/start`);
  if (status !== 204 && status !== 304) throw new DockerControlError(`start → ${status}: ${errMessage(json)}`);
}

/**
 * Recreate a container in place with a new Env + Labels, preserving image,
 * host config and network aliases. Equivalent to compose's --force-recreate
 * with env overrides. The caller must have ALREADY captured anything it needs
 * from the old container (e.g. logs) — removal destroys its log history.
 */
export async function recreateContainerWithEnv(
  name: string,
  inspect: ContainerInspect,
  env: string[],
  labels: Record<string, string>,
): Promise<void> {
  // Networks: replay aliases minus the old container's auto-added short-id.
  const endpoints: Record<string, unknown> = {};
  for (const [net, cfg] of Object.entries(inspect.NetworkSettings.Networks ?? {})) {
    endpoints[net] = { Aliases: (cfg.Aliases ?? []).filter((a) => !/^[0-9a-f]{12}$/.test(a)) };
  }

  // Hostname was derived from the OLD container id — drop it so Docker assigns
  // a fresh one matching the new container.
  const { Hostname: _oldHostname, ...config } = inspect.Config as Record<string, unknown>;

  const body: Record<string, unknown> = {
    ...config,
    Env: env,
    Labels: labels,
    HostConfig: inspect.HostConfig,
    NetworkingConfig: { EndpointsConfig: endpoints },
  };

  await removeContainer(name);
  const id = await createContainer(name, body);
  await startContainer(id);
}
