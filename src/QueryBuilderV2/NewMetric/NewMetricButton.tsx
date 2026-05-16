import { Button } from '@cube-dev/ui-kit';
import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Header CTA — opens the full-page New Metric wizard (v2).
 *
 * The legacy modal entry point lives behind the Settings dropdown ("New
 * metric (classic modal)"), which dispatches a window event picked up by
 * `LegacyNewMetricDialogMount` inside the QueryBuilder tree (where it has
 * access to cubes / reachable members).
 *
 * RR5 only — no useNavigate.
 */
export function NewMetricButton() {
  return (
    <Link to="/metrics/new?v=2" style={{ textDecoration: 'none' }}>
      <Button
        qa="NewMetricCTA"
        type="secondary"
        size="small"
        icon={<Sparkles size={14} />}
      >
        New metric
      </Button>
    </Link>
  );
}
