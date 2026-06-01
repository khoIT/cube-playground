/**
 * Error boundary around a dashboard tile's chart engine.
 *
 * The playground ChartRenderer accesses `loadResponse.results[...]` and calls
 * `resultSet.chartPivot()` at render time — a malformed/partial persisted load
 * response can construct a ResultSet yet still throw while rendering. Without a
 * boundary that throw would unmount the whole dashboard grid; here it degrades
 * to the lightweight fallback renderer instead.
 *
 * Remount via a `key` (e.g. the cache fetched_at) to re-attempt the engine path
 * after a fresh refresh.
 */

import React from 'react';

interface Props {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class TileChartBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // eslint-disable-next-line no-console
    console.warn('[tile] chart engine render failed, falling back:', (error as Error)?.message);
  }

  render(): React.ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
