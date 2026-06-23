/**
 * Sign-out + identity-header coverage for <UserMenu>.
 *
 * Mocks the auth context so we can (a) assert the sign-out item actually calls
 * `logout()` — the button used to be wired to nothing — and (b) confirm the
 * "Signed in as <email>" header renders from the authenticated identity.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../i18n';
import { AppContextProvider } from '../../AppContext';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { SecurityContextContext } from '../../SecurityContext/SecurityContextProvider';

const logoutSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../auth/auth-context', () => ({
  useAuth: () => ({ state: { status: 'authenticated' }, loginWithKeycloak: vi.fn(), logout: logoutSpy }),
  useAuthUser: () => ({ id: 'u1', username: 'khoitn', email: 'khoitn@vng.com.vn', role: 'admin' }),
}));

import { UserMenu } from '../user-menu';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  logoutSpy.mockClear();
});

function renderMenu() {
  const security = {
    payload: '',
    token: null,
    currentToken: null,
    isModalOpen: false,
    setIsModalOpen: vi.fn(),
    saveToken: vi.fn(),
    refreshToken: vi.fn(),
    onTokenPayloadChange: vi.fn(),
  };
  return render(
    <MemoryRouter initialEntries={['/build']}>
      <AppContextProvider playgroundContext={{ isCloud: false }}>
        <ThemeProvider>
          <SecurityContextContext.Provider value={security as any}>
            <UserMenu />
          </SecurityContextContext.Provider>
        </ThemeProvider>
      </AppContextProvider>
    </MemoryRouter>,
  );
}

describe('<UserMenu> sign-out + identity', () => {
  it('renders the signed-in email from the authenticated identity', () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('User menu'));
    expect(screen.getByTestId('user-menu-identity')).toBeTruthy();
    expect(screen.getByText('khoitn@vng.com.vn')).toBeTruthy();
  });

  it('derives initials from the email local part (KH, not the domain)', () => {
    renderMenu();
    expect(screen.getByLabelText('User menu').textContent).toContain('KH');
  });

  it('clicking sign out calls logout()', () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('User menu'));
    fireEvent.click(screen.getByTestId('user-menu-sign-out'));
    expect(logoutSpy).toHaveBeenCalledTimes(1);
  });
});
