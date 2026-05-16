/**
 * cube-card.test.tsx
 * Covers the description "More"/"Less" toggle on `<CubeCard>` and the
 * stopPropagation guard so expanding the description does not trigger the
 * cube-select onClick.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CubeCard } from '../cube-card';
import type { CatalogCube } from '../use-catalog-meta';

function cube(overrides: Partial<CatalogCube> = {}): CatalogCube {
  return {
    name: 'mf_users',
    type: 'cube',
    title: 'Ballistar VN — User Master Profile',
    description:
      'One row per user. Use this hub cube for lifetime aggregates and user attributes. Joins to every fact cube via user_id.',
    measures: [],
    dimensions: [],
    ...overrides,
  } as unknown as CatalogCube;
}

describe('<CubeCard> second-row game label', () => {
  it('em-dash title → shows only the part before " — "', () => {
    render(
      <CubeCard
        cube={cube({ title: 'Ballistar VN — User Master Profile' })}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByTestId('cube-card-game-label').textContent).toBe('Ballistar VN');
  });

  it('hyphen title → shows only the part before " - "', () => {
    render(
      <CubeCard
        cube={cube({ title: 'Ballistar VN - User Master Profile' })}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByTestId('cube-card-game-label').textContent).toBe('Ballistar VN');
  });

  it('no separator → falls back to the trimmed full title', () => {
    render(
      <CubeCard
        cube={cube({ title: 'Just A Game' })}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByTestId('cube-card-game-label').textContent).toBe('Just A Game');
  });

  it('no title → second row is omitted entirely', () => {
    render(
      <CubeCard cube={cube({ title: undefined })} selected={false} onClick={() => {}} />,
    );
    expect(screen.queryByTestId('cube-card-game-label')).toBeNull();
  });
});

describe('<CubeCard> description', () => {
  it('renders only the first sentence with a "More" toggle when description has multiple sentences', () => {
    render(<CubeCard cube={cube()} selected={false} onClick={() => {}} />);
    const desc = screen.getByTestId('cube-card-description');
    expect(desc.textContent).toMatch(/One row per user\./);
    expect(desc.textContent).not.toMatch(/Joins to every fact cube/);
    expect(screen.getByTestId('cube-card-more').textContent).toBe('More');
  });

  it('clicking "More" expands to full description and toggles label to "Less"', () => {
    const onClick = vi.fn();
    render(<CubeCard cube={cube()} selected={false} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('cube-card-more'));
    const desc = screen.getByTestId('cube-card-description');
    expect(desc.textContent).toMatch(/Joins to every fact cube via user_id/);
    expect(screen.getByTestId('cube-card-more').textContent).toBe('Less');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('clicking "More" does NOT bubble up to the card click handler', () => {
    const onClick = vi.fn();
    render(<CubeCard cube={cube()} selected={false} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('cube-card-more'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('single-sentence description renders without a toggle', () => {
    render(
      <CubeCard
        cube={cube({ description: 'Only one sentence.' })}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.queryByTestId('cube-card-more')).toBeNull();
    expect(screen.getByTestId('cube-card-description').textContent).toBe('Only one sentence.');
  });

  it('no description → no description block at all', () => {
    render(
      <CubeCard
        cube={cube({ description: undefined })}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.queryByTestId('cube-card-description')).toBeNull();
  });
});
