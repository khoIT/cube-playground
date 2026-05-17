import { useMemo } from 'react';
import type { WizardCube, WizardColumn } from '../../hooks/use-new-metric-meta';
import type { SlotAccepts } from '../steps/step-2-operation/operations';

export type EligibilityFilter = SlotAccepts | 'all-dimensions';

export type EligibleColumn = WizardColumn & {
  kind: 'dimension' | 'measure';
  /** Cube the column belongs to. Always populated so callers can group multi-cube results. */
  cubeName: string;
};
export type EligibilityResult = {
  eligible: EligibleColumn[];
  rejected: Array<EligibleColumn & { reason: string }>;
};

function isNumericLike(type: string | undefined): boolean {
  if (!type) return false;
  const lo = type.toLowerCase();
  return ['number', 'integer', 'count', 'sum', 'avg', 'min', 'max', 'count_distinct', 'countdistinctapprox'].includes(lo);
}

/**
 * Derive eligible columns for one input slot given a set of source cubes.
 *
 * `accepts === 'all'` returns every column (string + numeric + boolean).
 * `accepts === 'numeric'` keeps numeric/integer columns (dims + measures).
 * `'all-dimensions'` sentinel returns ONLY dimensions (used by filter dropdown).
 *
 * Phase 1: accepts a single cube via the back-compat wrapper below.
 * Phase 4: full migration to a `WizardCube[]` signature so multi-source flows
 * can union eligible columns across selected cubes. This phase keeps a
 * single-cube convenience caller alive so legacy reads keep compiling.
 */
export function useEligibleColumns(
  cubeOrCubes: WizardCube | WizardCube[] | null,
  accepts: EligibilityFilter
): EligibilityResult {
  return useMemo<EligibilityResult>(() => {
    const cubes: WizardCube[] = Array.isArray(cubeOrCubes)
      ? cubeOrCubes
      : cubeOrCubes
        ? [cubeOrCubes]
        : [];
    if (cubes.length === 0) return { eligible: [], rejected: [] };

    const eligible: EligibleColumn[] = [];
    const rejected: Array<EligibleColumn & { reason: string }> = [];

    function add(c: EligibleColumn, ok: boolean, reason: string) {
      if (ok) eligible.push(c);
      else rejected.push({ ...c, reason });
    }

    for (const cube of cubes) {
      const all: EligibleColumn[] = [
        ...(cube.dimensions ?? []).map<EligibleColumn>((d) => ({ ...d, kind: 'dimension', cubeName: cube.name })),
        ...(cube.measures ?? []).map<EligibleColumn>((m) => ({
          name: m.name, title: m.title, type: m.aggType, kind: 'measure', cubeName: cube.name,
        })),
      ];

      for (const c of all) {
        const t = c.type;
        // Measures are themselves aggregations and cannot be wrapped in another
        // SQL aggregate the wizard emits ({cube}.col → raw column reference).
        // Allow them only for filter dropdowns when explicitly enabled later;
        // today the picker stays column-only to avoid producing SQL that
        // resolves to a non-existent column at run time.
        if (c.kind === 'measure') {
          rejected.push({ ...c, reason: 'Measures cannot be wrapped in another aggregation.' });
          continue;
        }
        switch (accepts) {
          case 'all':
            eligible.push(c);
            break;
          case 'all-dimensions':
            add(c, c.kind === 'dimension', 'Filters only use dimensions.');
            break;
          case 'numeric':
            add(c, isNumericLike(t), `Type "${t ?? 'unknown'}" is not numeric.`);
            break;
          default:
            eligible.push(c);
        }
      }
    }
    return { eligible, rejected };
  }, [cubeOrCubes, accepts]);
}
