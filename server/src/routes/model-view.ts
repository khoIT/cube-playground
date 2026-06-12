/**
 * Read-only static mount for the Cube data-model viewer (ported from
 * cube-prod's gateway /model-view/ mount). Serves model-viewer/* from the repo
 * root: a self-contained React+ReactFlow page whose graph data is generated
 * from cube-dev/cube/model by model-viewer/gen_model_graph.py. Assets are read
 * fresh per request, so regenerating the graph needs no server restart.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, normalize, resolve, sep } from 'node:path';

import type { FastifyInstance } from 'fastify';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function viewerDir(): string | null {
  // Host dev server runs from server/ (repo root one up); tests/tools may run
  // from the repo root itself.
  for (const candidate of [
    resolve(process.cwd(), '..', 'model-viewer'),
    resolve(process.cwd(), 'model-viewer'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export default async function modelViewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/model-view', async (_request, reply) => reply.redirect('/model-view/'));

  app.get<{ Params: { '*': string } }>('/model-view/*', async (request, reply) => {
    const dir = viewerDir();
    if (!dir) {
      return reply.code(404).send({ error: 'model-viewer directory not found' });
    }
    const rel = request.params['*'] || 'index.html';
    const target = normalize(resolve(dir, rel));
    // Traversal guard: the resolved file must stay inside the viewer dir.
    if (target !== dir && !target.startsWith(dir + sep)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      return reply.code(404).send({ error: 'not found' });
    }
    const type = CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
    return reply.type(type).send(createReadStream(target));
  });
}
