import { useEffect, useState } from 'react';
import { DialogContainer } from '@cube-dev/ui-kit';
import { useNewMetricDraft } from './hooks/use-new-metric-draft';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { NewMetricDialog } from './NewMetricDialog';

export const LEGACY_NEW_METRIC_EVENT = 'open-legacy-new-metric-dialog';

/**
 * Mount point for the legacy fullscreen NewMetricDialog.
 *
 * Lives inside the QueryBuilder context (next to QueryStatePillBar) so that
 * `useReachableMembers` + cube meta are available. The dialog is opened by
 * dispatching a window event from the Settings dropdown:
 *
 *     window.dispatchEvent(new Event('open-legacy-new-metric-dialog'))
 */
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
