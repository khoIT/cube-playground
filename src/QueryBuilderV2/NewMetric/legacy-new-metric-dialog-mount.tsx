/**
 * @deprecated v1 mount removed from QueryStatePillBar and user-menu in the
 * 2026-05-23 redesign. The `LEGACY_NEW_METRIC_EVENT` export is retained so
 * any out-of-tree dispatcher fails gracefully (no listener) instead of
 * importing a missing symbol. File kept for one release; delete after.
 */
import { useEffect, useState } from 'react';
import { DialogContainer } from '@cube-dev/ui-kit';
import { useNewMetricDraft } from './hooks/use-new-metric-draft';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { NewMetricDialog } from './NewMetricDialog';

export const LEGACY_NEW_METRIC_EVENT = 'open-legacy-new-metric-dialog';
export function LegacyNewMetricDialogMount() {
  const initialGameId = useActiveGameId();
  const draftState = useNewMetricDraft({ initialGameId });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(LEGACY_NEW_METRIC_EVENT, handler);
    return () => window.removeEventListener(LEGACY_NEW_METRIC_EVENT, handler);
  }, []);

  function close() {
    setOpen(false);
    draftState.reset();
  }

  return (
    <DialogContainer
      type="fullscreen"
      isOpen={open}
      isDismissable
      onDismiss={close}
    >
      {open ? <NewMetricDialog onClose={close} draftState={draftState} /> : null}
    </DialogContainer>
  );
}
