import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, beforeAll, vi } from 'vitest';

vi.mock('react-responsive', () => ({
  useMediaQuery: ({ query }: { query: string }) => query.includes('min-width'),
}));

import i18n from '../../../i18n';
import { AppContextProvider } from '../../AppContext';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { SecurityContextProvider } from '../../SecurityContext/SecurityContextProvider';
import Header from '../Header';

function renderHeader(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <AppContextProvider playgroundContext={{ isCloud: false }}>
        <ThemeProvider>
          <SecurityContextProvider onTokenPayloadChange={async () => ''}>
            <Header selectedKeys={[pathname]} />
          </SecurityContextProvider>
        </ThemeProvider>
      </AppContextProvider>
    </MemoryRouter>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('<Header>', () => {
  it('renders nav pills: Playground / New Data Model / Catalog', () => {
    renderHeader('/build');
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Playground')).toBeTruthy();
    expect(within(nav).getByText('New Data Model')).toBeTruthy();
    expect(within(nav).getByText('Catalog')).toBeTruthy();
  });

  it('highlights the Playground pill on /build', () => {
    renderHeader('/build');
    const nav = screen.getByRole('navigation');
    const link = within(nav).getByText('Playground').closest('a');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/build');
  });

  it('renders New Data Model link pointing to /data-model/new?v=2', () => {
    renderHeader('/data-model/new');
    const nav = screen.getByRole('navigation');
    const link = within(nav).getByText('New Data Model').closest('a');
    expect(link!.getAttribute('href')).toBe('/data-model/new?v=2');
  });

  it('renders Catalog link pointing to /catalog', () => {
    renderHeader('/catalog');
    const nav = screen.getByRole('navigation');
    const link = within(nav).getByText('Catalog').closest('a');
    expect(link!.getAttribute('href')).toBe('/catalog');
  });
});
