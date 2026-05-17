import { useState } from 'react';
import { Flow, tasty } from '@cube-dev/ui-kit';

import { AnalysisMode, ModePicker } from './mode-picker';
import { BreakdownMode } from './breakdown-mode';
import { DistributionMode } from './distribution-mode';
import { FunnelMode } from './funnel-mode';

const PanelRoot = tasty({
  qa: 'AnalysisPanel',
  styles: {
    display: 'grid',
    gridRows: 'min-content minmax(0, 1fr)',
    gap: '1.5x',
    padding: '1.5x',
    /*
     * `fill: '#white'` removed: the Tabs container ends 4px above the active
     * tab button's actual bottom edge (the button overflows by 4px). With an
     * opaque white fill here, this panel covered the button's bottom 4px and
     * hid the active-tab `inset 0 -3px 0 #brand` underline. Parent already
     * provides `--bg-card`, so making this transparent is visually identical
     * but lets the underline shine through.
     */
    height: '100%',
    minHeight: '320px',
  },
});

const PickerRow = tasty({
  styles: {
    display: 'flex',
    placeItems: 'center start',
    gap: '1.5x',
  },
});

export function AnalysisPanel() {
  const [mode, setMode] = useState<AnalysisMode>('breakdown');

  return (
    <PanelRoot>
      <PickerRow>
        <ModePicker mode={mode} onChange={setMode} />
      </PickerRow>
      <Flow>
        {mode === 'breakdown' && <BreakdownMode />}
        {mode === 'distribution' && <DistributionMode />}
        {mode === 'funnel' && <FunnelMode />}
      </Flow>
    </PanelRoot>
  );
}
