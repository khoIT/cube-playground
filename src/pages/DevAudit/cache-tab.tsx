/**
 * CacheTab — placeholder for Phase 05 (Cache Effectiveness Dashboard).
 * Route: /dev/chat-audit/cache
 *
 * Phase 05 will replace this stub with the full cache dashboard.
 */
import React from 'react';
import { T } from '../../shell/theme';

const S = {
  root: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    color: T.n500,
    fontFamily: T.fSans,
    fontSize: 13,
  } as React.CSSProperties,
  label: {
    fontFamily: T.fMono,
    fontSize: 11,
    color: T.n400,
  } as React.CSSProperties,
};

export function CacheTab() {
  return (
    <div style={S.root} data-testid="cache-tab-placeholder">
      <span>Cache effectiveness coming soon</span>
      <span style={S.label}>Phase 04/05</span>
    </div>
  );
}
