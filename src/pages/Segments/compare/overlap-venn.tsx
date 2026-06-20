/**
 * Two-circle Venn where each circle's AREA is proportional to its cohort size
 * and the centre distance scales with the overlap, so the lens reads roughly to
 * scale. The lens area is not solved exactly (that needs a transcendental
 * root-find); instead the centre distance interpolates between tangent (no
 * overlap) and nested (full overlap) by the overlap fraction — visually honest
 * and cheap. Fills use the chart palette tokens at low opacity.
 */

import { ReactElement } from 'react';

interface Props {
  aSize: number;
  bSize: number;
  both: number;
  aLabel: string;
  bLabel: string;
}

const MAX_R = 66;
const PAD = 16;

function radiusFor(size: number, maxSize: number): number {
  if (maxSize <= 0) return 8;
  // Area ∝ size → radius ∝ sqrt(size); floor so a tiny cohort stays visible.
  return Math.max(8, MAX_R * Math.sqrt(size / maxSize));
}

export function OverlapVenn({ aSize, bSize, both, aLabel, bLabel }: Props): ReactElement {
  const maxSize = Math.max(aSize, bSize, 1);
  const rA = radiusFor(aSize, maxSize);
  const rB = radiusFor(bSize, maxSize);

  // Overlap fraction relative to the smaller cohort drives how nested the
  // circles are: 0 → tangent (d = rA + rB), 1 → nested (d = |rA − rB|).
  const minSize = Math.max(1, Math.min(aSize, bSize));
  const frac = Math.max(0, Math.min(1, both / minSize));
  const dTangent = rA + rB;
  const dNested = Math.abs(rA - rB);
  const d = dTangent - frac * (dTangent - dNested);

  const width = rA + d + rB + PAD * 2;
  const height = Math.max(rA, rB) * 2 + PAD * 2 + 22; // headroom for the count caption
  const cy = PAD + Math.max(rA, rB);
  const cxA = PAD + rA;
  const cxB = cxA + d;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${aLabel} ${aSize} members, ${bLabel} ${bSize} members, ${both} shared`}
      style={{ maxWidth: width, display: 'block' }}
    >
      <circle cx={cxA} cy={cy} r={rA} fill="var(--chart-1)" fillOpacity={0.28} stroke="var(--chart-1)" strokeOpacity={0.9} strokeWidth={1.5} />
      <circle cx={cxB} cy={cy} r={rB} fill="var(--chart-2)" fillOpacity={0.28} stroke="var(--chart-2)" strokeOpacity={0.9} strokeWidth={1.5} />
      {/* Overlap count sits at the midpoint of the centre line when there is a lens. */}
      {both > 0 && (
        <text
          x={(cxA + cxB) / 2}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fontWeight={700}
          fill="var(--text-primary)"
        >
          {both.toLocaleString()}
        </text>
      )}
    </svg>
  );
}
