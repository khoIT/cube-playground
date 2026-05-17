import { render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../ThemeContext';
import { useTheme } from '../use-theme';

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
    window.localStorage.clear();
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

  it('toggle flips light → dark → light and persists to localStorage', () => {
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
    expect(window.localStorage.getItem('gds-cube:theme')).toBe('dark');

    act(() => {
      screen.getByTestId('toggle').click();
    });

    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(window.localStorage.getItem('gds-cube:theme')).toBe('light');
  });

  it('initialises from localStorage when present', () => {
    window.localStorage.setItem('gds-cube:theme', 'dark');

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
