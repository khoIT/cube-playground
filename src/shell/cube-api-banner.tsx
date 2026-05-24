/**
 * Surfaces an in-app warning when the upstream Cube backend stops responding.
 *
 * The dev-time boot guard (scripts/ensure-cube-api.mjs) covers cold starts and
 * the hung-but-up case, but cube_api can still die mid-session — without this
 * banner the playground silently hangs on every query. Polled via
 * useCubeApiHealth; only renders when the probe has confirmed 'unreachable'.
 */
import { Alert, Button } from 'antd';

import { useCubeApiHealth } from '../hooks/use-cube-api-health';

export function CubeApiBanner() {
  const status = useCubeApiHealth();
  if (status !== 'unreachable') return null;

  return (
    <Alert
      banner
      showIcon
      type="error"
      message="Cube backend unreachable"
      description={
        <span>
          The playground can&apos;t reach <code>cube_api</code> at port 4000.
          Restart it from <code>~/Documents/code/cube-dev</code> with{' '}
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
