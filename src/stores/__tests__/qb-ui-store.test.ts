import { describe, it, expect } from 'vitest';
import { createQbUiStore } from '../qb-ui-store';

describe('qb-ui-store factory', () => {
  it('C1: two stores are independent', () => {
    const a = createQbUiStore();
    const b = createQbUiStore();
    a.getState().toggleCube('Orders');
    expect(a.getState().openCubes.has('Orders')).toBe(true);
    expect(b.getState().openCubes.has('Orders')).toBe(false);
  });

  it('toggleCube adds and removes membership', () => {
    const s = createQbUiStore();
    s.getState().toggleCube('Orders');
    expect(s.getState().openCubes.has('Orders')).toBe(true);
    s.getState().toggleCube('Orders');
    expect(s.getState().openCubes.has('Orders')).toBe(false);
  });

  it('openCube is a no-op when already open (no new Set identity)', () => {
    const s = createQbUiStore();
    s.getState().openCube('Orders');
    const first = s.getState().openCubes;
    s.getState().openCube('Orders');
    expect(s.getState().openCubes).toBe(first);
  });

  it('setFilterString updates the filter slice', () => {
    const s = createQbUiStore();
    s.getState().setFilterString('rev');
    expect(s.getState().filterString).toBe('rev');
  });

  it('reset() clears openCubes and viewMode', () => {
    const s = createQbUiStore();
    s.getState().toggleCube('Orders');
    s.getState().setViewMode('views');
    s.getState().setFilterString('rev');
    s.getState().reset();
    expect(s.getState().openCubes.size).toBe(0);
    expect(s.getState().viewMode).toBe('cubes');
    expect(s.getState().filterString).toBe('');
  });
});
