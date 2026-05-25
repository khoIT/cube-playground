/**
 * Tests for skeleton-row variants:
 * - SkelRow renders a div with aria-hidden
 * - SkelCard renders a div with aria-hidden
 * - SkelText renders n bars with aria-hidden
 * - SkelText last bar is narrower (60% width)
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkelRow, SkelCard, SkelText } from '../skeleton-row';

describe('SkelRow', () => {
  it('renders a single div aria-hidden', () => {
    const { container } = render(<SkelRow />);
    const div = container.firstChild as HTMLElement;
    expect(div).toBeTruthy();
    expect(div.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies default height of 58px via inline style', () => {
    const { container } = render(<SkelRow />);
    const div = container.firstChild as HTMLElement;
    expect(div.style.height).toBe('58px');
  });

  it('applies custom height', () => {
    const { container } = render(<SkelRow height={38} />);
    const div = container.firstChild as HTMLElement;
    expect(div.style.height).toBe('38px');
  });
});

describe('SkelCard', () => {
  it('renders a div with aria-hidden', () => {
    const { container } = render(<SkelCard />);
    const div = container.firstChild as HTMLElement;
    expect(div.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies default height 96px', () => {
    const { container } = render(<SkelCard />);
    const div = container.firstChild as HTMLElement;
    expect(div.style.height).toBe('96px');
  });

  it('applies custom height', () => {
    const { container } = render(<SkelCard height={120} />);
    const div = container.firstChild as HTMLElement;
    expect(div.style.height).toBe('120px');
  });
});

describe('SkelText', () => {
  it('renders n=3 bars by default', () => {
    const { container } = render(<SkelText />);
    // wrapper div + 3 bar divs
    const bars = container.querySelectorAll('[aria-hidden="true"]');
    expect(bars).toHaveLength(3);
  });

  it('renders custom n bars', () => {
    const { container } = render(<SkelText n={5} />);
    const bars = container.querySelectorAll('[aria-hidden="true"]');
    expect(bars).toHaveLength(5);
  });

  it('last bar has width 60% (paragraph-end affordance)', () => {
    const { container } = render(<SkelText n={3} />);
    const bars = Array.from(container.querySelectorAll('[aria-hidden="true"]')) as HTMLElement[];
    expect(bars[bars.length - 1].style.width).toBe('60%');
  });

  it('non-last bars have width 100%', () => {
    const { container } = render(<SkelText n={3} />);
    const bars = Array.from(container.querySelectorAll('[aria-hidden="true"]')) as HTMLElement[];
    expect(bars[0].style.width).toBe('100%');
    expect(bars[1].style.width).toBe('100%');
  });
});
