/**
 * Surfaces an in-app warning when the upstream Cube backend stops responding.
 *
 * Two states render:
 *   - unreachable: red banner with the recovery hint.
 *   - recovered (was-unreachable, now ok): green banner prompting reload.
 *     The page's in-flight cube fetches have no timeout, so after an outage
 *     they're dead even though new requests would succeed — the user must
 *     reload to actually see data again.
 */
import { Alert, Button } from 'antd';

import { useCubeApiHealth } from '../hooks/use-cube-api-health';

export function CubeApiBanner() {
  const { status, hadOutage, acknowledgeRecovery } = useCubeApiHealth();

  if (status === 'unreachable') {
    return (
      <Alert
        banner
        showIcon
        type="error"
        message="Cube backend unreachable"
        description={
          <span>
            The playground can&apos;t reach <code>cube_api</code> at port 4000.
            The local boot guard tries to recover it automatically; if this
            sticks, restart it from <code>~/Documents/code/cube-dev</code> with{' '}
            <code>docker compose restart cube_api</code>, or rerun{' '}
            <code>npm run dev:all</code>.
          </span>
        }
        action={
          <Button size="small" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
        style={{ borderRadius: 0 }}
      />
    );
  }

  if (status === 'ok' && hadOutage) {
    return (
      <Alert
        banner
        showIcon
        type="success"
        message="Cube backend recovered"
        description="Reload the page so in-flight requests pick up fresh data — they timed out during the outage."
        action={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button size="small" type="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <Button size="small" onClick={acknowledgeRecovery}>
              Dismiss
            </Button>
          </span>
        }
        style={{ borderRadius: 0 }}
      />
    );
  }

  return null;
}
