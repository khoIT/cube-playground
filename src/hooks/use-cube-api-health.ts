/**
 * Lightweight liveness probe for the upstream Cube backend.
 *
 * Probes `/api/meta/version` through the gateway — a game-independent endpoint
 * that reflects upstream Cube liveness (it hashes the cached `/meta`). The
 * legacy `/cubejs-api/v1/meta` direct-Cube path was retired here: it bypassed
 * the gateway and 500'd once that upstream stopped serving HEAD /meta, flooding
 * the console while the probe silently treated the 500 as "ok".
 *
 * Two distinct failure shapes, told apart by HOW the probe fails:
 *   - The gateway answers 5xx (502 CUBE_UNREACHABLE): the gateway is up but the
 *     Cube backend behind it is down → kind 'cube', alarm immediately.
 *   - The fetch itself throws / times out: the GATEWAY isn't answering. On a
 *     dev host this is almost always a 1–3s tsx-watch restart after a server
 *     file save, so a single network failure is CONFIRMED with one quick retry
 *     (3s) before flipping to 'unreachable' (kind 'gateway') — otherwise every
 *     server-file save flashed a false "Cube backend unreachable" banner.
 *   - A 4xx still counts as "alive" (server up, e.g. auth).
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
 * reload and would otherwise leave no trace. (Confirmed gateway outages count
 * too: from the user's seat the data backend is equally unusable.)
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { recordCubeOutage } from '../api/feature-open-beacon';

export type CubeApiHealth = 'unknown' | 'ok' | 'unreachable';

/** What broke: the Cube backend behind the gateway, or the gateway itself. */
export type CubeOutageKind = 'cube' | 'gateway';

export interface CubeApiHealthResult {
  status: CubeApiHealth;
  /** Set while status is 'unreachable' (and kept through recovery display). */
  outageKind: CubeOutageKind | null;
  /** True once 'unreachable' has been observed during this mount. */
  hadOutage: boolean;
  /** Manually clear the outage flag (used by the recovery banner). */
  acknowledgeRecovery: () => void;
}

const PROBE_PATH = '/api/meta/version';
const PROBE_TIMEOUT_MS = 4000;
const POLL_INTERVAL_MS = 15_000;
/** Re-probe delay used to confirm a network-level failure before alarming. */
const GATEWAY_CONFIRM_DELAY_MS = 3000;

type ProbeOutcome = 'ok' | 'cube-down' | 'gateway-down' | 'aborted';

async function probeOnce(signal: AbortSignal): Promise<ProbeOutcome> {
  const ctl = new AbortController();
  const onParentAbort = () => ctl.abort();
  signal.addEventListener('abort', onParentAbort);
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    // GET is fine — the version endpoint returns a tiny hash, not the full
    // meta payload.
    const res = await fetch(PROBE_PATH, { method: 'GET', signal: ctl.signal });
    return res.status >= 500 ? 'cube-down' : 'ok';
  } catch {
    return signal.aborted ? 'aborted' : 'gateway-down';
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onParentAbort);
  }
}

export function useCubeApiHealth(): CubeApiHealthResult {
  const [status, setStatus] = useState<CubeApiHealth>('unknown');
  const [outageKind, setOutageKind] = useState<CubeOutageKind | null>(null);
  const [hadOutage, setHadOutage] = useState(false);
  // Latest hadOutage in a ref so the polling closure doesn't need to be re-bound
  // each render when the outage flag flips.
  const hadOutageRef = useRef(false);
  // Last observed status + when the current outage began — used to detect edges
  // and measure outage duration for the recovery beacon.
  const lastStatusRef = useRef<CubeApiHealth>('unknown');
  const outageStartRef = useRef<number | null>(null);
  // True while a single gateway-down result awaits its confirming re-probe.
  const confirmingGatewayRef = useRef(false);

  useEffect(() => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const outcome = await probeOnce(ctl.signal);
      if (ctl.signal.aborted) return;

      let delay = POLL_INTERVAL_MS;

      if (outcome !== 'aborted') {
        if (
          outcome === 'gateway-down' &&
          lastStatusRef.current !== 'unreachable' &&
          !confirmingGatewayRef.current
        ) {
          // First network-level failure while previously healthy: likely a
          // dev-server (tsx watch) restart blip. Re-probe shortly instead of
          // declaring an outage — no state change, no banner.
          confirmingGatewayRef.current = true;
          delay = GATEWAY_CONFIRM_DELAY_MS;
        } else {
          confirmingGatewayRef.current = false;
          const next: CubeApiHealth = outcome === 'ok' ? 'ok' : 'unreachable';
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
          if (next === 'unreachable') {
            setOutageKind(outcome === 'cube-down' ? 'cube' : 'gateway');
            if (!hadOutageRef.current) {
              hadOutageRef.current = true;
              setHadOutage(true);
            }
          }
        }
      }

      if (!ctl.signal.aborted) timer = setTimeout(tick, delay);
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
    setOutageKind(null);
  }, []);

  return { status, outageKind, hadOutage, acknowledgeRecovery };
}
