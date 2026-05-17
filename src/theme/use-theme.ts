import { useContext } from 'react';

import { ThemeContext, ThemeContextValue } from './ThemeContext';

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
