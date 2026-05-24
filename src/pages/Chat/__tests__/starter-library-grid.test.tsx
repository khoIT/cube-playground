import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StarterLibraryGrid } from '../components/starter-library-grid';
import { STARTER_QUESTIONS } from '../library/starter-questions';

describe('StarterLibraryGrid', () => {
  it('renders all starters in the provided order', () => {
    render(<StarterLibraryGrid starters={STARTER_QUESTIONS} onPick={() => {}} />);
    const grid = screen.getByTestId('starter-library-grid');
    expect(grid.querySelectorAll('button[data-starter-id]').length).toBe(STARTER_QUESTIONS.length);
  });

  it('calls onPick with the clicked starter and does NOT auto-submit', () => {
    const onPick = vi.fn();
    render(<StarterLibraryGrid starters={STARTER_QUESTIONS} onPick={onPick} />);
    const first = STARTER_QUESTIONS[0];
    const btn = document.querySelector(`button[data-starter-id="${first.id}"]`)!;
    fireEvent.click(btn);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].id).toBe(first.id);
  });

  it('renders nothing in the grid when given empty array', () => {
    render(<StarterLibraryGrid starters={[]} onPick={() => {}} />);
    const grid = screen.getByTestId('starter-library-grid');
    expect(grid.querySelectorAll('button').length).toBe(0);
  });
});
