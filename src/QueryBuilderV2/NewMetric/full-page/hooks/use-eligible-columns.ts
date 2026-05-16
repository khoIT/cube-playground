import { useMemo } from 'react';
import type { WizardCube, WizardColumn } from '../../hooks/use-new-metric-meta';
import type { OperationAccepts } from '../steps/step-2-operation/operations';

export type EligibleColumn = WizardColumn & { kind: 'dimension' | 'measure' };
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
 * Derive eligible columns for an operation given a source cube.
 * Used by Step 3 (column picker) and Step 4 (filter column dropdown).
 *
 * `accepts === 'all'` returns every column (string + numeric + boolean).
 * `accepts === 'numeric'` keeps numeric/integer.
 * `accepts === 'none'` (Count) returns empty — Step 3 is auto-skipped.
 * `accepts === '2-numeric'` returns numeric measures (Ratio).
 * `'all-dimensions'` sentinel returns ONLY dimensions (used by filter dropdown).
 */
export function useEligibleColumns(
  cube: WizardCube | null,
  accepts: OperationAccepts | 'all-dimensions'
): EligibilityResult {
  return useMemo<EligibilityResult>(() => {
    if (!cube) return { eligible: [], rejected: [] };
    const all: EligibleColumn[] = [
      ...(cube.dimensions ?? []).map<EligibleColumn>((d) => ({ ...d, kind: 'dimension' })),
      ...(cube.measures ?? []).map<EligibleColumn>((m) => ({
        name: m.name, title: m.title, type: m.aggType, kind: 'measure',
      })),
    ];
    const eligible: EligibleColumn[] = [];
    const rejected: Array<EligibleColumn & { reason: string }> = [];

    function add(c: EligibleColumn, ok: boolean, reason: string) {
      if (ok) eligible.push(c);
      else rejected.push({ ...c, reason });
    }

    for (const c of all) {
      const t = c.type;
      switch (accepts) {
        case 'none':
          rejected.push({ ...c, reason: 'Operation does not use a column.' });
          break;
        case 'all':
          eligible.push(c);
          break;
        case 'all-dimensions':
          add(c, c.kind === 'dimension', 'Filters only use dimensions.');
          break;
        case 'numeric':
          add(c, isNumericLike(t), `Type "${t ?? 'unknown'}" is not numeric.`);
          break;
        case '2-numeric':
          add(c, c.kind === 'measure' && isNumericLike(t), 'Ratio operands must be numeric measures.');
          break;
        default:
          eligible.push(c);
      }
    }
    return { eligible, rejected };
  }, [cube, accepts]);
}
