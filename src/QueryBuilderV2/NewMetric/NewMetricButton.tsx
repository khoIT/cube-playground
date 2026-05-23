/**
 * @deprecated Unused header CTA. Header now uses `NavPill` with `/data-model/new?v=2`.
 * The lightweight business-metric form lives at `/catalog/metric/new`. Kept for
 * one release in case external embedders import it; delete after that.
 */
import { Button } from '@cube-dev/ui-kit';
import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NewMetricButton() {
  return (
    <Link to="/data-model/new?v=2" style={{ textDecoration: 'none' }}>
      <Button
        qa="NewMetricCTA"
        type="secondary"
        size="small"
        icon={<Sparkles size={14} />}
      >
        New data model
      </Button>
    </Link>
  );
}
