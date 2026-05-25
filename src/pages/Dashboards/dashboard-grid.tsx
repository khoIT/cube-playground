/**
 * DashboardGrid — react-grid-layout wrapper, 12-col, drag-resize.
 * Layout changes are debounced 500ms before persisting to avoid
 * flooding the server on every drag pixel.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import GridLayout, { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

import { dashboardsClient, type LayoutItem } from '../../api/dashboards-client';
import type { DashboardTile } from '../../api/dashboards-client';
import { Tile } from './tile';

const COLS = 12;
const ROW_HEIGHT = 80;
const DEBOUNCE_MS = 500;

interface DashboardGridProps {
  tiles: DashboardTile[];
  slug: string;
  gameId: string;
  /** Called after a tile is deleted so the parent can refetch. */
  onTileDeleted?: (tileId: number) => void;
  onTitleChange?: (tileId: number, title: string) => void;
}

function tileToLayout(tile: DashboardTile): Layout {
  let pos = { x: 0, y: 0, w: 4, h: 3 };
  try {
    const p = JSON.parse(tile.position_json);
    if (p && typeof p.x === 'number') pos = p;
  } catch {
    /* use defaults */
  }
  return { i: String(tile.id), x: pos.x, y: pos.y, w: pos.w, h: pos.h };
}

export function DashboardGrid({
  tiles,
  slug,
  gameId,
  onTileDeleted,
  onTitleChange,
}: DashboardGridProps) {
  const [layout, setLayout] = useState<Layout[]>(() => tiles.map(tileToLayout));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track container width for responsive rendering
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);

  // Sync layout when tiles change from outside (e.g. after a refetch)
  useEffect(() => {
    setLayout(tiles.map(tileToLayout));
  }, [tiles]);

  // Measure container width on mount and resize
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const persistLayout = useCallback(
    (nextLayout: Layout[]) => {
      const items: LayoutItem[] = nextLayout.map((l) => ({
        tileId: parseInt(l.i, 10),
        position: { x: l.x, y: l.y, w: l.w, h: l.h },
      }));
      dashboardsClient.saveLayout(slug, gameId, items).catch(() => {
        /* layout save is best-effort */
      });
    },
    [slug, gameId],
  );

  const handleLayoutChange = useCallback(
    (newLayout: Layout[]) => {
      setLayout(newLayout);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        persistLayout(newLayout);
      }, DEBOUNCE_MS);
    },
    [persistLayout],
  );

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleDelete = useCallback(
    (tileId: number) => {
      dashboardsClient
        .deleteTile(slug, gameId, tileId)
        .then(() => onTileDeleted?.(tileId))
        .catch(() => {/* non-critical */});
    },
    [slug, gameId, onTileDeleted],
  );

  if (tiles.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 200,
          color: 'var(--text-muted)',
          fontSize: 14,
        }}
      >
        No tiles yet. Pin a query from the Playground.
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <GridLayout
        className="dashboard-grid-layout"
        layout={layout}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        width={width}
        isDraggable
        isResizable
        draggableHandle=".tile-drag-handle"
        onLayoutChange={handleLayoutChange}
        margin={[12, 12]}
        containerPadding={[0, 0]}
      >
        {tiles.map((tile) => (
          <div key={String(tile.id)} style={{ overflow: 'hidden' }}>
            {/* Invisible drag handle strip at top */}
            <div
              className="tile-drag-handle"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 12,
                cursor: 'grab',
                zIndex: 10,
              }}
              aria-hidden="true"
            />
            <Tile
              tile={tile}
              slug={slug}
              gameId={gameId}
              onDelete={onTileDeleted ? handleDelete : undefined}
              onTitleChange={onTitleChange}
            />
          </div>
        ))}
      </GridLayout>
    </div>
  );
}
