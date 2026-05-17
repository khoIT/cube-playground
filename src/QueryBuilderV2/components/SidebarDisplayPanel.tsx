import { useMemo, useState } from 'react';
import {
  Block,
  Button,
  Checkbox,
  CubeIcon,
  Dialog,
  DialogContainer,
  Flex,
  Header as UIHeader,
  SearchInput,
  Text,
  Title as UITitle,
  TooltipProvider,
  ViewIcon,
  tasty,
} from '@cube-dev/ui-kit';
import { Settings } from 'lucide-react';

const GearButton = tasty(Button, {
  qa: 'SidebarDisplayPanelTrigger',
  'aria-label': 'Display tables',
  type: 'secondary',
  size: 'small',
  styles: {
    height: 'var(--row-height-tight)',
    width: 'var(--row-height-tight)',
    padding: 0,
    placeContent: 'center',
  },
});

const HiddenBadge = tasty(Block, {
  styles: {
    position: 'absolute',
    top: '-3px',
    right: '-3px',
    minWidth: '14px',
    height: '14px',
    padding: '0 4px',
    radius: '999px',
    fill: '#brand',
    color: '#white',
    fontSize: '9px',
    fontWeight: 700,
    lineHeight: '14px',
    textAlign: 'center',
  },
});

const ListScroll = tasty(Flex, {
  styles: {
    flow: 'column',
    gap: '1bw',
    width: '100%',
    maxHeight: 'min(60vh, 520px)',
    overflow: 'auto',
    border: '1bw solid #dark-05',
    radius: '.5x',
    padding: '.5x',
  },
});

const Row = tasty(Block, {
  styles: {
    display: 'block',
    width: '100%',
    padding: '.5x .75x',
    radius: '.5x',
    fill: {
      '': '#clear',
      hovered: '#purple.16',
    },
    transition: 'fill .08s ease',

    /* Stretch the inner Checkbox so its label covers the whole row, making the
       full row a single click target without needing onClick on the wrapper. */
    '& [role="checkbox"]': {
      width: '100%',
    },
  },
});

const MasterRow = tasty(Block, {
  styles: {
    display: 'block',
    width: '100%',
    padding: '.5x .75x',
    margin: '0 0 .5x 0',
    radius: '.5x',
    fill: '#dark-04.4',

    '& [role="checkbox"]': {
      width: '100%',
    },
  },
});

const RowLabel = tasty(Block, {
  styles: {
    flexGrow: 1,
    minWidth: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
});

type CubeEntry = {
  name: string;
  title?: string;
  type: 'cube' | 'view';
};

type Props = {
  cubes: CubeEntry[];
  isVisible: (name: string) => boolean;
  onToggle: (name: string) => void;
  onSetAll: (value: boolean, names: string[]) => void;
};

export function SidebarDisplayPanel({
  cubes,
  isVisible,
  onToggle,
  onSetAll,
}: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const allNames = useMemo(() => cubes.map((c) => c.name), [cubes]);
  const hiddenCount = useMemo(
    () => allNames.filter((n) => !isVisible(n)).length,
    [allNames, isVisible]
  );
  const allChecked = hiddenCount === 0;
  const someChecked = hiddenCount > 0 && hiddenCount < cubes.length;

  const filteredCubes = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return cubes;
    return cubes.filter((c) => {
      const label = (c.title || c.name).toLowerCase();
      return label.includes(needle) || c.name.toLowerCase().includes(needle);
    });
  }, [cubes, filter]);

  if (!cubes.length) return null;

  const trigger = (
    <TooltipProvider title="Display tables" placement="bottom">
      <Block style={{ position: 'relative', display: 'inline-block' }}>
        <GearButton
          icon={<Settings size={14} strokeWidth={2.25} />}
          onPress={() => setOpen(true)}
        />
        {hiddenCount > 0 ? <HiddenBadge>{hiddenCount}</HiddenBadge> : null}
      </Block>
    </TooltipProvider>
  );

  return (
    <>
      {trigger}
      <DialogContainer isOpen={open} onDismiss={() => setOpen(false)}>
        {open ? (
          <Dialog
            isDismissable
            size="M"
            styles={{ minWidth: 'min(640px, 90vw)' }}
          >
            <UIHeader>
              <UITitle>Display tables</UITitle>
              <Text color="#dark-03" preset="t4">
                {hiddenCount === 0
                  ? `${cubes.length} shown`
                  : `${cubes.length - hiddenCount} of ${cubes.length} shown`}
              </Text>
            </UIHeader>
            <Flex flow="column" gap="1x" padding="1x" width="100%">
              <SearchInput
                isClearable
                size="small"
                aria-label="Filter tables"
                placeholder="Filter tables"
                value={filter}
                onChange={setFilter}
              />
              <ListScroll>
                {filteredCubes.length === 0 ? (
                  <Block padding="1x .75x" color="#dark-03">
                    No tables match "{filter}"
                  </Block>
                ) : (
                  <>
                    <MasterRow qa="SidebarDisplayMasterRow">
                      <Checkbox
                        aria-label={
                          allChecked ? 'Deselect all tables' : 'Select all tables'
                        }
                        isSelected={allChecked}
                        isIndeterminate={someChecked && !allChecked}
                        onChange={() => onSetAll(!allChecked, allNames)}
                      >
                        <RowLabel>
                          <Text preset="t4m">
                            {allChecked
                              ? 'Deselect all'
                              : someChecked
                                ? `Select all (${cubes.length - hiddenCount}/${cubes.length})`
                                : 'Select all'}
                          </Text>
                        </RowLabel>
                      </Checkbox>
                    </MasterRow>
                    {filteredCubes.map((cube) => (
                      <Row
                        key={cube.name}
                        qa="SidebarDisplayRow"
                        qaVal={cube.name}
                      >
                        <Checkbox
                          aria-label={cube.title || cube.name}
                          isSelected={isVisible(cube.name)}
                          onChange={() => onToggle(cube.name)}
                        >
                          <Flex gap=".5x" placeItems="center" width="100%">
                            {cube.type === 'view' ? (
                              <ViewIcon style={{ fontSize: 14, flexShrink: 0 }} />
                            ) : (
                              <CubeIcon style={{ fontSize: 14, flexShrink: 0 }} />
                            )}
                            <RowLabel title={cube.title || cube.name}>
                              {cube.title || cube.name}
                            </RowLabel>
                          </Flex>
                        </Checkbox>
                      </Row>
                    ))}
                  </>
                )}
              </ListScroll>
            </Flex>
            <Flex
              gap="1x"
              placeContent="end"
              placeItems="center"
              padding="1x"
              border="top"
              width="100%"
            >
              <Button
                type="primary"
                size="small"
                onPress={() => setOpen(false)}
              >
                Done
              </Button>
            </Flex>
          </Dialog>
        ) : null}
      </DialogContainer>
    </>
  );
}
