/**
 * Slim status strip shown when the upstream Cube backend stops responding.
 *
 * Two states render as a single-line strip (~28px, not the old full-height
 * Alert) so an outage is visible without dominating the viewport:
 *   - unreachable: red strip, retry hint, Reload.
 *   - recovered (was-unreachable, now ok): green strip prompting reload. The
 *     page's in-flight cube fetches have no timeout, so after an outage they're
 *     dead even though new requests would succeed — the user must reload to see
 *     data again. Dismiss clears it without reloading.
 *
 * The strip names what actually broke: 'cube' (gateway up, Cube backend down)
 * vs 'gateway' (the playground server itself not answering) — the health hook
 * tells them apart and filters out brief dev-server restart blips entirely.
 *
 * The detailed "how to restart" hint moves to the strip's title tooltip to
 * keep the single line uncluttered. Colors use the semantic
 * destructive/success tokens so the strip adapts to dark mode.
 */
import { Button } from 'antd';

import { useCubeApiHealth } from '../hooks/use-cube-api-health';

const STRIP_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '5px 16px',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1.4,
  borderBottom: '1px solid var(--border-card)',
};

const CUBE_RESTART_HINT =
  'The local boot guard auto-recovers cube_api. If it sticks, restart it from ' +
  '~/Documents/code/cube-dev with `docker compose restart cube_api`, or rerun `npm run dev:all`.';

const GATEWAY_RESTART_HINT =
  'The playground gateway itself is not answering (Cube may be fine behind it). ' +
  'On a dev host check the `npm run dev` terminal; brief tsx-watch restarts are filtered out, ' +
  'so a persistent strip means the server crashed.';

export function CubeApiBanner() {
  const { status, outageKind, hadOutage, acknowledgeRecovery } = useCubeApiHealth();

  if (status === 'unreachable') {
    const gatewayDown = outageKind === 'gateway';
    // User-facing copy is the same for both outage kinds — a transient
    // reconnect reads friendliest framed as a likely update, not an error.
    // The dev-facing "how to restart" detail stays in the title tooltip, and
    // the amber (warning) tone signals "temporary" rather than "broken".
    return (
      <div
        role="alert"
        title={gatewayDown ? GATEWAY_RESTART_HINT : CUBE_RESTART_HINT}
        style={{ ...STRIP_BASE, background: 'var(--warning-soft)', color: 'var(--warning-ink)' }}
      >
        <span style={{ flex: 1 }}>
          🔄 Reconnecting to the server… this can happen briefly during an update. Retrying every 15s.
        </span>
        <Button size="small" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }

  if (status === 'ok' && hadOutage) {
    return (
      <div
        role="status"
        style={{ ...STRIP_BASE, background: 'var(--success-soft)', color: 'var(--success-ink)' }}
      >
        <span style={{ flex: 1 }}>✓ Back online — reload to refresh your data.</span>
        <Button size="small" type="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button size="small" type="text" onClick={acknowledgeRecovery} aria-label="Dismiss">
          ✕
        </Button>
      </div>
    );
  }

  return null;
}
