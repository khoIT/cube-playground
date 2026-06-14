/**
 * OpenInPlayground — a subtle token-styled link that opens the Cube query
 * builder (`#/build`) pre-loaded with a given raw Cube query. Used as the
 * per-chart header action on the Ops Console so a reader can pivot straight from
 * a trend chart into the playground to explore the exact query feeding it.
 */
import React from 'react';
import { useHistory } from 'react-router-dom';
import type { Query } from '@cubejs-client/core';
import { buildQueryDeeplink } from '../../utils/playground-deeplink';

interface OpenInPlaygroundProps {
  query: Query;
  label?: string;
}

export function OpenInPlayground({ query, label = 'Open in Playground' }: OpenInPlaygroundProps) {
  const history = useHistory();
  const onClick = () => {
    // buildQueryDeeplink returns a "#/build?..." hash; react-router v5 push()
    // wants the path without the leading '#'.
    const url = buildQueryDeeplink(query as unknown as Record<string, unknown>);
    history.push(url.startsWith('#') ? url.slice(1) : url);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        background: 'transparent',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-sans)',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label} ↗
    </button>
  );
}
