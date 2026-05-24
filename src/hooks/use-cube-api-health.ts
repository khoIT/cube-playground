/**
 * Lightweight liveness probe for the upstream Cube backend.
 *
 * Probes `/cubejs-api/v1/meta` through the vite dev proxy. Treats any HTTP
 * response as "alive" (a 401/403 from cube means the server is up but our
 * token is wrong — still a backend-is-running signal). Only network failures
 * and timeouts flip the status to 'unreachable', which is the case the boot
 * guard couldn't recover from and the user needs to see.
 */
import { useEffect, useState } from 'react';

export type CubeApiHealth = 'unknown' | 'ok' | 'unreachable';

const PROBE_PATH = '/cubejs-api/v1/meta';
const PROBE_TIMEOUT_MS = 4000;
const POLL_INTERVAL_MS = 15_000;

async function probeOnce(signal: AbortSignal): Promise<CubeApiHealth> {
  const ctl = new AbortController();
  const onParentAbort = () => ctl.abort();
  signal.addEventListener('abort', onParentAbort);
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    // HEAD avoids transferring the (potentially large) meta payload every poll.
    // Cube returns the same status codes for HEAD as GET on this endpoint.
    await fetch(PROBE_PATH, { method: 'HEAD', signal: ctl.signal });
    return 'ok';
  } catch {
    return signal.aborted ? 'unknown' : 'unreachable';
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onParentAbort);
  }
}

export function useCubeApiHealth(): CubeApiHealth {
  const [status, setStatus] = useState<CubeApiHealth>('unknown');

  useEffect(() => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const next = await probeOnce(ctl.signal);
      if (!ctl.signal.aborted && next !== 'unknown') setStatus(next);
      if (!ctl.signal.aborted) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    tick();
    return () => {
      ctl.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return status;
}
