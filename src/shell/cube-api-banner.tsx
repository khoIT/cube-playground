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
 * The detailed "how to restart cube_api" hint moves to the strip's title
 * tooltip to keep the single line uncluttered. Colors use the semantic
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

const RESTART_HINT =
  'The local boot guard auto-recovers cube_api. If it sticks, restart it from ' +
  '~/Documents/code/cube-dev with `docker compose restart cube_api`, or rerun `npm run dev:all`.';

export function CubeApiBanner() {
  const { status, hadOutage, acknowledgeRecovery } = useCubeApiHealth();

  if (status === 'unreachable') {
    return (
      <div
        role="alert"
        title={RESTART_HINT}
        style={{ ...STRIP_BASE, background: 'var(--destructive-soft)', color: 'var(--destructive-ink)' }}
      >
        <span style={{ flex: 1 }}>
          ⛔ Cube backend unreachable · retrying every 15s
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
        <span style={{ flex: 1 }}>
          ✓ Cube backend recovered · reload so in-flight requests pick up fresh data
        </span>
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
