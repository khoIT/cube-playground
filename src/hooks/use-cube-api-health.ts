/**
 * Lightweight liveness probe for the upstream Cube backend.
 *
 * Probes `/api/meta/version` through the gateway — a game-independent endpoint
 * that reflects upstream Cube liveness (it hashes the cached `/meta`). The
 * legacy `/cubejs-api/v1/meta` direct-Cube path was retired here: it bypassed
 * the gateway and 500'd once that upstream stopped serving HEAD /meta, flooding
 * the console while the probe silently treated the 500 as "ok". A 4xx still
 * counts as "alive" (server up, e.g. auth); only a 5xx (gateway reports the
 * Cube backend down — 502 CUBE_UNREACHABLE), network failure, or timeout flips
 * the status to 'unreachable', which is the case the boot guard couldn't
 * recover from and the user needs to see.
 *
 * Also exposes `hadOutage` — a sticky bit set the first time we see
 * 'unreachable'. The page's in-flight cube requests (e.g. cubejs-client meta)
 * have no timeout, so after recovery they're effectively dead and the user
 * needs to reload to refresh. The banner reads this to switch into a green
 * "Backend recovered" recovery state.
 *
 * On each reachability EDGE (ok→unreachable, unreachable→ok) it also fires a
 * fire-and-forget `cube_outage` beacon to the activity spine so outages are
 * countable/measurable after the fact — the in-memory state above resets on
 * reload and would otherwise leave no trace.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { recordCubeOutage } from '../api/feature-open-beacon';

export type CubeApiHealth = 'unknown' | 'ok' | 'unreachable';

export interface CubeApiHealthResult {
  status: CubeApiHealth;
  /** True once 'unreachable' has been observed during this mount. */
  hadOutage: boolean;
  /** Manually clear the outage flag (used by the recovery banner). */
  acknowledgeRecovery: () => void;
}

const PROBE_PATH = '/api/meta/version';
const PROBE_TIMEOUT_MS = 4000;
const POLL_INTERVAL_MS = 15_000;

async function probeOnce(signal: AbortSignal): Promise<CubeApiHealth> {
  const ctl = new AbortController();
  const onParentAbort = () => ctl.abort();
  signal.addEventListener('abort', onParentAbort);
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    // GET is fine — the version endpoint returns a tiny hash, not the full
    // meta payload. A 5xx means the gateway can't reach the Cube backend
    // (502 CUBE_UNREACHABLE); a 4xx still means the server itself is up.
    const res = await fetch(PROBE_PATH, { method: 'GET', signal: ctl.signal });
    return res.status >= 500 ? 'unreachable' : 'ok';
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
  // Last observed status + when the current outage began — used to detect edges
  // and measure outage duration for the recovery beacon.
  const lastStatusRef = useRef<CubeApiHealth>('unknown');
  const outageStartRef = useRef<number | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const next = await probeOnce(ctl.signal);
      if (!ctl.signal.aborted && next !== 'unknown') {
        const prev = lastStatusRef.current;
        // Edge-trigger the outage beacon: report only on transitions, never on
        // every steady-state poll (which would flood the spine while down).
        if (next !== prev) {
          if (next === 'unreachable') {
            outageStartRef.current = Date.now();
            recordCubeOutage('unreachable');
          } else if (next === 'ok' && prev === 'unreachable') {
            const startedAt = outageStartRef.current;
            recordCubeOutage('recovered', startedAt != null ? Date.now() - startedAt : undefined);
            outageStartRef.current = null;
          }
          lastStatusRef.current = next;
        }
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
