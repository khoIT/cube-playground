/**
 * Lightweight liveness probe for the upstream Cube backend.
 *
 * Probes `/cubejs-api/v1/meta` through the vite dev proxy. Treats any HTTP
 * response as "alive" (a 401/403 from cube means the server is up but our
 * token is wrong — still a backend-is-running signal). Only network failures
 * and timeouts flip the status to 'unreachable', which is the case the boot
 * guard couldn't recover from and the user needs to see.
 *
 * Also exposes `hadOutage` — a sticky bit set the first time we see
 * 'unreachable'. The page's in-flight cube requests (e.g. cubejs-client meta)
 * have no timeout, so after recovery they're effectively dead and the user
 * needs to reload to refresh. The banner reads this to switch into a green
 * "Backend recovered" recovery state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type CubeApiHealth = 'unknown' | 'ok' | 'unreachable';

export interface CubeApiHealthResult {
  status: CubeApiHealth;
  /** True once 'unreachable' has been observed during this mount. */
  hadOutage: boolean;
  /** Manually clear the outage flag (used by the recovery banner). */
  acknowledgeRecovery: () => void;
}

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

export function useCubeApiHealth(): CubeApiHealthResult {
  const [status, setStatus] = useState<CubeApiHealth>('unknown');
  const [hadOutage, setHadOutage] = useState(false);
  // Latest hadOutage in a ref so the polling closure doesn't need to be re-bound
  // each render when the outage flag flips.
  const hadOutageRef = useRef(false);

  useEffect(() => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const next = await probeOnce(ctl.signal);
      if (!ctl.signal.aborted && next !== 'unknown') {
        setStatus(next);
        if (next === 'unreachable' && !hadOutageRef.current) {
          hadOutageRef.current = true;
          setHadOutage(true);
        }
      }
      if (!ctl.signal.aborted) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    tick();
    return () => {
      ctl.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const acknowledgeRecovery = useCallback(() => {
    hadOutageRef.current = false;
    setHadOutage(false);
  }, []);

  return { status, hadOutage, acknowledgeRecovery };
}
