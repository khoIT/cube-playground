/**
 * CacheSparkline — pure-SVG hits/misses bar chart for the hit-rate hero card.
 *
 * Renders paired vertical bars per day: hits in brand orange, misses in n300.
 * No external chart library. Width ~200, height ~40 by default.
 */

import React from 'react';
import { T } from '../../shell/theme';
import type { CacheSparklineDay } from '../../api/cache-effectiveness-types';

interface Props {
  data: CacheSparklineDay[];
  width?: number;
  height?: number;
}

const BAR_GAP = 1;   // gap between hit and miss bar within a day
const GROUP_GAP = 3; // gap between day groups

export function CacheSparkline({ data, width = 200, height = 40 }: Props) {
  if (data.length === 0) {
    // Flat baseline — nothing to show yet
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        data-testid="cache-sparkline"
      >
        <line x1={0} y1={height - 1} x2={width} y2={height - 1} stroke={T.n300} strokeWidth={1} opacity={0.4} />
      </svg>
    );
  }

  const maxTotal = Math.max(1, ...data.map((d) => d.hits + d.misses));
  const n = data.length;
  // Each group = 2 bars side-by-side
  const groupW = (width - GROUP_GAP * (n - 1)) / n;
  const barW = Math.max(1, (groupW - BAR_GAP) / 2);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      data-testid="cache-sparkline"
    >
      {data.map((day, i) => {
        const groupX = i * (groupW + GROUP_GAP);
        const hitH = Math.max(1, (day.hits / maxTotal) * (height - 2));
        const missH = Math.max(day.misses > 0 ? 1 : 0, (day.misses / maxTotal) * (height - 2));
        const hitY = height - hitH;
        const missY = height - missH;
        const missX = groupX + barW + BAR_GAP;

        return (
          <g key={day.day}>
            <title>{`${day.day}: ${day.hits} hits · ${day.misses} misses`}</title>
            {/* hits bar */}
            <rect
              x={groupX}
              y={hitY}
              width={barW}
              height={hitH}
              fill={T.brand}
              rx={1}
              data-testid="bar-hits"
            />
            {/* misses bar */}
            {day.misses > 0 && (
              <rect
                x={missX}
                y={missY}
                width={barW}
                height={missH}
                fill={T.n300}
                rx={1}
                data-testid="bar-misses"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
