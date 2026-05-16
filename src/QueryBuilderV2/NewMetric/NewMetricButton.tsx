import { Button, DialogTrigger } from '@cube-dev/ui-kit';
import { Sparkles } from 'lucide-react';
import { useNewMetricDraft } from './hooks/use-new-metric-draft';
import { NewMetricDialog } from './NewMetricDialog';

/**
 * Header CTA that opens the fullscreen New Metric wizard.
 * Owns the open/close toggle and the draft state lifecycle.
 * Rendered by Header.tsx on desktop only.
 */
export function NewMetricButton() {
  const draftState = useNewMetricDraft();

  return (
    <DialogTrigger type="fullscreen" isDismissable>
      <Button
        qa="NewMetricCTA"
        type="secondary"
        size="small"
        icon={<Sparkles size={14} />}
      >
        New metric
      </Button>
      <NewMetricDialog
        onClose={() => draftState.reset()}
        draftState={draftState}
      />
    </DialogTrigger>
  );
}
