import { Button, tasty } from '@cube-dev/ui-kit';

export const ListButton = tasty(Button, {
  type: 'clear',
  size: 'small',
  styles: {
    color: '#dark',
    opacity: {
      '': '1',
      disabled: '.5',
    },
    border: {
      '': '#clear',
      '[data-type="outline"]': '#purple.5',
      disabled: '#purple',
    },
    placeContent: 'space-between',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    textAlign: 'left',
    minHeight: 'var(--row-height-tight)',
    padding: '(.5x - 1bw) (0.75x - 1bw) (.5x - 1bw) (1.25x - 1bw)',
  },
});
