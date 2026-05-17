import type { NewMetricDraftV3 } from '../types';
import { generateV2, GenerateContext } from './generate-measure-yaml';
import { generateDimension } from './generate-dimension';
import { generateSegment } from './generate-segment';

export type EntrySectionKey = 'measures' | 'dimensions' | 'segments';

export type EntryEmit = {
  yaml: string;
  fragment: string;
  sectionKey: EntrySectionKey;
};

/**
 * Dispatch by `draft.artifactKind`:
 *   - measure   → existing `generateV2`
 *   - dimension → `generateDimension` (per-sub-kind logic inside)
 *   - segment   → `generateSegment` (wraps `flattenToSql`)
 *
 * Each generator returns the inner mapping (`fragment`), the section block
 * (`yaml`), and the `sectionKey` the splicer + preview rail use to route the
 * patch. Throws on unknown `artifactKind`.
 */
export function generateEntry(
  draft: NewMetricDraftV3,
  ctx: GenerateContext
): EntryEmit {
  switch (draft.artifactKind) {
    case 'measure': {
      const { yaml: y, fragment } = generateV2(draft, ctx);
      return { yaml: y, fragment, sectionKey: 'measures' };
    }
    case 'dimension':
      return generateDimension(draft, ctx);
    case 'segment':
      return generateSegment(draft, ctx);
    default:
      throw new Error(
        `generate-cube-entry: unsupported artifactKind "${String((draft as NewMetricDraftV3).artifactKind)}"`
      );
  }
}
