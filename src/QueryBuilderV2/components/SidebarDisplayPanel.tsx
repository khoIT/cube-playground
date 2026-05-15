import { useMemo, useState } from 'react';
import {
  Block,
  Button,
  Checkbox,
  CubeIcon,
  Flex,
  Space,
  Text,
  ViewIcon,
  tasty,
} from '@cube-dev/ui-kit';
import { ChevronDown, ChevronRight, Settings } from 'lucide-react';

const PanelShell = tasty({
  styles: {
    radius: '.5x',
    border: '1bw solid #dark-05',
    fill: '#white',
  },
});

const HeaderRow = tasty(Button, {
  type: 'clear',
  size: 'small',
  styles: {
    width: '100%',
    placeContent: 'space-between',
    padding: '.5x 1x',
    radius: '.5x .5x 0 0',
    fontWeight: '500',
  },
});

const ListContainer = tasty(Flex, {
  styles: {
    flow: 'column',
    gap: '0',
    maxHeight: '240px',
    overflow: 'auto',
    padding: '.5x 1x',
    border: 'top #dark-05',
  },
});

const FooterRow = tasty(Space, {
  styles: {
    placeContent: 'end',
    gap: '1x',
    padding: '.5x 1x',
    border: 'top #dark-05',
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
  defaultCollapsed?: boolean;
};

const STORAGE_KEY = 'gds-cube:sidebar-display-panel-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeCollapsed(next: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
  } catch {
    // ignore quota errors
  }
}

export function SidebarDisplayPanel({
  cubes,
  isVisible,
  onToggle,
  onSetAll,
}: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  const allNames = useMemo(() => cubes.map((c) => c.name), [cubes]);
  const hiddenCount = useMemo(
    () => allNames.filter((n) => !isVisible(n)).length,
    [allNames, isVisible]
  );

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(next);
      return next;
    });
  }

  if (!cubes.length) return null;

  return (
    <PanelShell>
      <HeaderRow
        qa="SidebarDisplayPanelToggle"
        aria-expanded={!collapsed}
        onPress={toggleCollapsed}
      >
        <Space gap=".75x">
          {collapsed ? (
            <ChevronRight size={14} strokeWidth={2.25} />
          ) : (
            <ChevronDown size={14} strokeWidth={2.25} />
          )}
          <Settings size={14} strokeWidth={2.25} />
          <Text preset="t4m">Display</Text>
          {hiddenCount > 0 ? (
            <Text preset="c2" color="#dark-03">
              ({hiddenCount} hidden)
            </Text>
          ) : null}
        </Space>
      </HeaderRow>
      {!collapsed ? (
        <>
          <ListContainer>
            {cubes.map((cube) => (
              <Checkbox
                key={cube.name}
                isSelected={isVisible(cube.name)}
                onChange={() => onToggle(cube.name)}
              >
                <Space gap=".5x" placeItems="center">
                  {cube.type === 'view' ? (
                    <ViewIcon style={{ fontSize: 12 }} />
                  ) : (
                    <CubeIcon style={{ fontSize: 12 }} />
                  )}
                  <Block>{cube.title || cube.name}</Block>
                </Space>
              </Checkbox>
            ))}
          </ListContainer>
          <FooterRow>
            <Button
              qa="SidebarDisplaySelectAll"
              type="link"
              size="small"
              onPress={() => onSetAll(true, allNames)}
            >
              Select all
            </Button>
            <Button
              qa="SidebarDisplayDeselectAll"
              type="link"
              size="small"
              onPress={() => onSetAll(false, allNames)}
            >
              Deselect all
            </Button>
          </FooterRow>
        </>
      ) : null}
    </PanelShell>
  );
}
