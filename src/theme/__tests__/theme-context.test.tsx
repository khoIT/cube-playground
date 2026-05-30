import { render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { removePref, setPref, getPref } from '../../hooks/server-prefs-store';
import { ThemeProvider } from '../ThemeContext';
import { useTheme } from '../use-theme';

const STORAGE_KEY = 'gds-cube:theme';

function Probe() {
  const { theme, toggle, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button data-testid="toggle" onClick={toggle}>
        toggle
      </button>
      <button data-testid="set-dark" onClick={() => setTheme('dark')}>
        set dark
      </button>
      <button data-testid="set-light" onClick={() => setTheme('light')}>
        set light
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    // Remove via store API so in-memory cache is flushed alongside localStorage.
    removePref(STORAGE_KEY);
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to light and stamps data-theme on <html>', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('toggle flips light → dark → light and persists to the pref store mirror', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    act(() => {
      screen.getByTestId('toggle').click();
    });

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    // setPref writes to localStorage mirror synchronously.
    expect(getPref(STORAGE_KEY)).toBe('dark');

    act(() => {
      screen.getByTestId('toggle').click();
    });

    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(getPref(STORAGE_KEY)).toBe('light');
  });

  it('initialises from pref store when a value is present', () => {
    // Seed via store API so in-memory cache is warmed (getPref prefers cache over localStorage).
    setPref(STORAGE_KEY, 'dark');

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('setTheme writes the chosen value', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    act(() => {
      screen.getByTestId('set-dark').click();
    });
    expect(screen.getByTestId('theme').textContent).toBe('dark');

    act(() => {
      screen.getByTestId('set-light').click();
    });
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });
});
