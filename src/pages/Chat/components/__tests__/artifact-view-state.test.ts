/**
 * Per-artifact view-state cache — a chart→table toggle (and chart type / axis /
 * comparison choices) remembered against the artifact id so the same artifact
 * shows the same view when it next mounts on another surface (e.g. the right-
 * side chat panel).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  getArtifactViewState,
  rememberArtifactViewState,
  __resetArtifactViewStateForTests,
} from '../artifact-view-state';

afterEach(() => __resetArtifactViewStateForTests());

describe('artifact-view-state cache', () => {
  it('returns undefined for an artifact never toggled', () => {
    expect(getArtifactViewState('art-1')).toBeUndefined();
  });

  it('remembers the last view state keyed by artifact id', () => {
    rememberArtifactViewState('art-1', { view: 'table', comparisonView: 'overlaid' });
    expect(getArtifactViewState('art-1')).toEqual({ view: 'table', comparisonView: 'overlaid' });

    // A later toggle (e.g. user switches back to a chart with a type override) wins.
    rememberArtifactViewState('art-1', {
      view: 'chart',
      overrideType: 'horizontal-bar',
      comparisonView: 'overlaid',
    });
    expect(getArtifactViewState('art-1')).toEqual({
      view: 'chart',
      overrideType: 'horizontal-bar',
      comparisonView: 'overlaid',
    });
  });

  it('keeps state per artifact id (no cross-talk)', () => {
    rememberArtifactViewState('art-1', { view: 'table', comparisonView: 'overlaid' });
    rememberArtifactViewState('art-2', { view: 'chart', comparisonView: 'indexed' });
    expect(getArtifactViewState('art-1')?.view).toBe('table');
    expect(getArtifactViewState('art-2')?.view).toBe('chart');
    expect(getArtifactViewState('art-2')?.comparisonView).toBe('indexed');
  });
});
