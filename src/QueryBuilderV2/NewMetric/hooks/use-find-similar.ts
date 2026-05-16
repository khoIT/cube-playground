import { useMemo } from 'react';
import { useQueryBuilderContext } from '../../context';
import { Operation } from '../types';

/**
 * Map the wizard's user-facing operation onto the `aggType` strings Cube
 * surfaces in `/meta`. `aggType` is a derived field — its values come from the
 * compiler, not the YAML — so this is verified empirically against the dev
 * meta payload rather than spec-driven.
 */
const OP_TO_AGG_TYPE: Record<Operation, string> = {
  sum: 'sum',
  count: 'count',
  countDistinct: 'countDistinctApprox',
  avg: 'avg',
  min: 'min',
  max: 'max',
  ratio: 'number',
};

export type SimilarMeasure = {
  name: string;       // qualified: cube.measure
  title: string;
  description?: string;
  cubeName: string;
};

type MeasureLike = {
  name: string;
  title?: string;
  description?: string;
  aggType?: string;
};

type CubeLike = {
  name: string;
  measures?: MeasureLike[];
};

/**
 * Returns existing measures on `sourceCube` whose `aggType` matches the
 * wizard's current operation. Loose match — `measure.sql` is security-stripped
 * by Cube so an exact column-overlap check isn't possible.
 *
 * Returns an empty array when sourceCube or operation are unset.
 */
export function useFindSimilar(
  sourceCube: string | null,
  operation: Operation,
): SimilarMeasure[] {
  const { cubes } = useQueryBuilderContext();

  return useMemo(() => {
    if (!sourceCube) return [];
    const targetAggType = OP_TO_AGG_TYPE[operation];
    if (!targetAggType) return [];

    const cube = (cubes as unknown as CubeLike[]).find((c) => c.name === sourceCube);
    if (!cube || !Array.isArray(cube.measures)) return [];

    return cube.measures
      .filter((m) => m.aggType === targetAggType)
      .map<SimilarMeasure>((m) => ({
        name: m.name,
        title: m.title ?? m.name,
        description: m.description,
        cubeName: sourceCube,
      }));
  }, [cubes, sourceCube, operation]);
}
