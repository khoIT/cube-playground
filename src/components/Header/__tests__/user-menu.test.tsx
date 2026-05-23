import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import i18n from '../../../i18n';
import { AppContextProvider } from '../../AppContext';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { OPEN_ROLLUP_DESIGNER_EVENT } from '../../../rollup-designer';
import { SecurityContextContext } from '../../SecurityContext/SecurityContextProvider';
import { UserMenu } from '../user-menu';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

function renderUserMenu(opts: {
  setIsModalOpen: ReturnType<typeof vi.fn>;
  pathname?: string;
  token?: string | null;
}) {
  const value = {
    payload: '',
    token: opts.token ?? null,
    currentToken: opts.token ?? null,
    isModalOpen: false,
    setIsModalOpen: opts.setIsModalOpen,
    saveToken: vi.fn(),
    refreshToken: vi.fn(),
    onTokenPayloadChange: vi.fn(),
  };

  return render(
    <MemoryRouter initialEntries={[opts.pathname ?? '/build']}>
      <AppContextProvider playgroundContext={{ isCloud: false }}>
        <ThemeProvider>
          <SecurityContextContext.Provider value={value as any}>
            <UserMenu />
          </SecurityContextContext.Provider>
        </ThemeProvider>
      </AppContextProvider>
    </MemoryRouter>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByLabelText('User menu'));
}

describe('<UserMenu>', () => {
  it('opens the security-context modal via setIsModalOpen', () => {
    const setIsModalOpen = vi.fn();
    renderUserMenu({ setIsModalOpen });
    openMenu();
    fireEvent.click(screen.getByTestId('user-menu-security-context'));
    expect(setIsModalOpen).toHaveBeenCalledWith(true);
  });

  it('no longer renders the legacy new-metric menu item', () => {
    const setIsModalOpen = vi.fn();
    renderUserMenu({ setIsModalOpen });
    openMenu();
    expect(screen.queryByTestId('user-menu-legacy-new-metric')).toBeNull();
  });

  it('shows the rollup item on /build and dispatches OPEN_ROLLUP_DESIGNER_EVENT', () => {
    const setIsModalOpen = vi.fn();
    const listener = vi.fn();
    window.addEventListener(OPEN_ROLLUP_DESIGNER_EVENT, listener);
    renderUserMenu({ setIsModalOpen, pathname: '/build' });
    openMenu();
    fireEvent.click(screen.getByTestId('user-menu-add-rollup'));
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_ROLLUP_DESIGNER_EVENT, listener);
  });

  it('hides the rollup item when not on /build', () => {
    const setIsModalOpen = vi.fn();
    renderUserMenu({ setIsModalOpen, pathname: '/catalog' });
    openMenu();
    expect(screen.queryByTestId('user-menu-add-rollup')).toBeNull();
  });

  it('shows the security-context active dot when a token is set', () => {
    const setIsModalOpen = vi.fn();
    const { container } = renderUserMenu({ setIsModalOpen, token: 'tok' });
    const trigger = screen.getByLabelText('User menu');
    // active dot lives inside the trigger button
    expect(trigger.querySelector('span[aria-hidden]')).not.toBeNull();
  });
});
