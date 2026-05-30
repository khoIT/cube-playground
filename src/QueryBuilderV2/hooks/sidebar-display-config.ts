import { useCallback, useMemo } from 'react';

import { useServerPref } from '../../hooks/use-server-pref';

const STORAGE_KEY = 'gds-cube:sidebar-display-config';

export type SidebarDisplayConfig = Record<string, boolean>;

export type UseSidebarDisplayConfigResult = {
  config: SidebarDisplayConfig;
  visibleCubes: string[];
  isVisible: (name: string) => boolean;
  toggleCube: (name: string) => void;
  setAll: (value: boolean, cubeNames: string[]) => void;
};

export function useSidebarDisplayConfig(
  allCubeNames: string[]
): UseSidebarDisplayConfigResult {
  const [config, setConfig] = useServerPref<SidebarDisplayConfig>(
    STORAGE_KEY,
    {}
  );

  const safeConfig = config ?? {};

  const isVisible = useCallback(
    (name: string) => safeConfig[name] !== false,
    [safeConfig]
  );

  const visibleCubes = useMemo(
    () => allCubeNames.filter(isVisible),
    [allCubeNames, isVisible]
  );

  const toggleCube = useCallback(
    (name: string) => {
      const nextVisible = !(safeConfig[name] !== false);
      const next: SidebarDisplayConfig = { ...safeConfig, [name]: nextVisible };
      setConfig(next);
    },
    [safeConfig, setConfig]
  );

  const setAll = useCallback(
    (value: boolean, cubeNames: string[]) => {
      const next: SidebarDisplayConfig = { ...safeConfig };
      for (const name of cubeNames) {
        next[name] = value;
      }
      setConfig(next);
    },
    [safeConfig, setConfig]
  );

  return { config: safeConfig, visibleCubes, isVisible, toggleCube, setAll };
}
