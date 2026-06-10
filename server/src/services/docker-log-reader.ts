/**
 * Thin Docker Engine API client for reading container logs over the Unix socket.
 *
 * Uses Node's built-in `http` module over the Docker Unix socket — no new deps.
 * Socket path defaults to /var/run/docker.sock (Docker Desktop / Linux) but can
 * be overridden via PREAGG_DOCKER_SOCKET for runtimes that place it elsewhere
 * (e.g. Colima at ~/.colima/<profile>/docker.sock on macOS).
 * Docker's log stream uses 8-byte multiplexed frame headers for non-TTY
 * containers:
 *   byte 0: stream type (0=stdin, 1=stdout, 2=stderr)
 *   bytes 1-3: padding (zeros)
 *   bytes 4-7: BE uint32 payload length
 *   bytes 8…: payload
 *
 * On ANY error (socket missing, ENOENT, container not found, non-200 status)
 * this module throws a typed DockerLogError so the collector can catch it
 * and enter degraded mode without crashing the server.
 */

import * as http from 'node:http';

const DOCKER_SOCKET = process.env.PREAGG_DOCKER_SOCKET || '/var/run/docker.sock';
// Each Docker multiplexed frame header is exactly 8 bytes
const FRAME_HEADER_BYTES = 8;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class DockerLogError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DockerLogError';
  }
}

// ---------------------------------------------------------------------------
// Pure frame demultiplexer — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Demultiplex a Docker multiplexed log stream buffer into individual log lines.
 *
 * Handles partial final frames gracefully (skips incomplete payloads) so a
 * mid-stream buffer slice doesn't crash the parser.
 */
export function demuxDockerStream(buf: Buffer): string[] {
  const lines: string[] = [];
  let offset = 0;

  while (offset + FRAME_HEADER_BYTES <= buf.length) {
    // Bytes 4-7: big-endian uint32 payload length
    const payloadLen = buf.readUInt32BE(offset + 4);

    // Guard: skip malformed / truncated frames
    if (offset + FRAME_HEADER_BYTES + payloadLen > buf.length) break;

    const payload = buf
      .subarray(offset + FRAME_HEADER_BYTES, offset + FRAME_HEADER_BYTES + payloadLen)
      .toString('utf8');

    // A single frame may contain multiple newline-separated log lines
    const frameLines = payload.split('\n');
    for (const line of frameLines) {
      const trimmed = line.trim();
      if (trimmed) lines.push(trimmed);
    }

    offset += FRAME_HEADER_BYTES + payloadLen;
  }

  return lines;
}

// ---------------------------------------------------------------------------
// HTTP-over-socket request helper
// ---------------------------------------------------------------------------

function socketGet(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path,
        method: 'GET',
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(
            new DockerLogError(
              `Docker API returned ${res.statusCode} for ${path}`,
            ),
          );
          res.resume(); // drain
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', (err) =>
          reject(new DockerLogError('Response stream error', err)),
        );
      },
    );

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        reject(
          new DockerLogError(
            `Docker socket unavailable at ${DOCKER_SOCKET}: ${err.code}`,
            err,
          ),
        );
      } else {
        reject(new DockerLogError(`Docker socket request failed: ${err.message}`, err));
      }
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read stdout+stderr log lines from a Docker container since the given Unix
 * timestamp (seconds). Returns an array of log line strings.
 *
 * Throws DockerLogError on any failure — callers should catch and degrade
 * gracefully rather than crashing.
 *
 * The `follow=false` flag means we get a finite snapshot, not a streaming
 * connection. This is intentional: the collector runs on a fixed interval and
 * only needs the delta since the last pass.
 */
export async function readWorkerLogsSince(
  container: string,
  sinceUnix: number,
): Promise<string[]> {
  const path =
    `/containers/${encodeURIComponent(container)}/logs` +
    `?stdout=1&stderr=1&timestamps=1&since=${Math.floor(sinceUnix)}&follow=false`;

  const buf = await socketGet(path);

  // Docker attaches 8-byte frame headers for non-TTY containers.
  // If the first byte is a valid stream type (0,1,2) treat it as multiplexed;
  // otherwise fall back to plain text (TTY=true containers).
  if (buf.length >= FRAME_HEADER_BYTES && buf[0] <= 2) {
    return demuxDockerStream(buf);
  }

  // TTY / raw fallback — split on newlines
  return buf
    .toString('utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
