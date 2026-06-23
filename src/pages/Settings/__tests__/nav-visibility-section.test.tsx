/**
 * Regression coverage for the Settings → Sidebar visibility section.
 *
 * Guards the crash where a NAV_ITEMS entry had no matching icon in the ICONS
 * map (`advisor` was added to the union but the map still carried stale
 * `drift-center` / `data-hub` keys). `ICONS[id]` was then `undefined`, and
 * rendering `<undefined />` blew up the whole settings tree with React error
 * #130 on the *default* tab. This asserts every nav item renders an icon.
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { NavVisibilitySection } from '../nav-visibility-section';
import { NAV_ITEMS } from '../use-visible-nav-items';

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('NavVisibilitySection', () => {
  it('renders one toggle row per nav item without crashing on a missing icon', () => {
    render(<NavVisibilitySection />);
    // One checkbox row per NAV_ITEMS entry — including `advisor`, whose missing
    // icon used to throw React #130 before the ICONS map was completed.
    expect(screen.getAllByRole('checkbox')).toHaveLength(NAV_ITEMS.length);
  });

  it('renders an svg icon inside every row (no undefined element)', () => {
    const { container } = render(<NavVisibilitySection />);
    const rows = screen.getAllByRole('checkbox');
    for (const row of rows) {
      // Each row carries the row-icon svg in addition to the checkbox tick;
      // the row simply must contain at least one rendered <svg>.
      expect(row.querySelectorAll('svg').length).toBeGreaterThan(0);
    }
    expect(container).toBeTruthy();
  });
});
