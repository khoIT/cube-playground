import { useMemo } from 'react';
import { useQueryBuilderContext } from '../../context';

type MeasureWithMeta = { meta?: { tags?: unknown } };
type CubeWithMeasures = { measures?: MeasureWithMeta[] };

/**
 * Union of every `meta.tags` array across every measure in the loaded /meta.
 * Result is alphabetically sorted and case-sensitive (Revenue ≠ revenue) so it
 * stays consistent with the validation rules.
 */
export function useExistingTags(): string[] {
  const { cubes } = useQueryBuilderContext();

  return useMemo(() => {
    const seen = new Set<string>();
    for (const cube of cubes as unknown as CubeWithMeasures[]) {
      const measures = cube.measures ?? [];
      for (const m of measures) {
        const tags = m.meta?.tags;
        if (!Array.isArray(tags)) continue;
        for (const tag of tags) {
          if (typeof tag === 'string' && tag.trim().length > 0) {
            seen.add(tag);
          }
        }
      }
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [cubes]);
}
