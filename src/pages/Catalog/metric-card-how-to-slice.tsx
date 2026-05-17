/**
 * MetricCardHowToSlice — renders the non-PK, non-hidden dimensions of the
 * source cube. Time dimensions come first since they're the most common
 * slice axis. Truncates at 10 entries to keep the card scannable; the cube
 * detail panel remains the authoritative full list.
 */

import type { CatalogCube, CatalogDimension } from './use-catalog-meta';
import { Section, SectionTitle, Row, Code, Chip, MutedText } from './metric-card-styles';

const MAX_DIMS = 10;

function sliceableDimensions(cube: CatalogCube): CatalogDimension[] {
  const filtered = cube.dimensions.filter(
    (d) => d.public !== false && !d.primaryKey,
  );
  return filtered.sort((a, b) => {
    const ta = a.type === 'time' ? 0 : 1;
    const tb = b.type === 'time' ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });
}

function shortName(qualified: string): string {
  const dot = qualified.indexOf('.');
  return dot >= 0 ? qualified.slice(dot + 1) : qualified;
}

interface Props {
  cube: CatalogCube;
}

export function MetricCardHowToSlice({ cube }: Props) {
  const all = sliceableDimensions(cube);
  if (all.length === 0) return null;
  const head = all.slice(0, MAX_DIMS);
  const overflow = all.length - head.length;

  return (
    <Section>
      <SectionTitle>How to slice it ({all.length})</SectionTitle>
      {head.map((d) => (
        <Row key={d.name}>
          <span>
            <Code>{shortName(d.name)}</Code>
            {d.type && <Chip>{d.type}</Chip>}
          </span>
        </Row>
      ))}
      {overflow > 0 && (
        <MutedText>and {overflow} more — see cube detail in the catalog</MutedText>
      )}
    </Section>
  );
}
