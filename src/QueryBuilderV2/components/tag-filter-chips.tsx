import { useMemo } from 'react';
import styled from 'styled-components';
import { useQueryBuilderContext } from '../context';
import { useSelectedTags } from '../hooks/use-selected-tags';

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-card);
  background: var(--bg-card);
`;

const Label = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-right: 4px;
`;

const Chip = styled.button<{ $active: boolean }>`
  appearance: none;
  cursor: pointer;
  padding: 2px 10px;
  font-size: 11.5px;
  border-radius: var(--radius-pill);
  border: 1px solid
    ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-strong)')};
  background: ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-on-brand)' : 'var(--text-secondary)')};

  &:hover {
    background: ${(p) =>
      p.$active ? 'var(--brand-hover)' : 'var(--bg-muted)'};
  }
`;

const Clear = styled.button`
  appearance: none;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
  text-decoration: underline;
`;

type CubeLike = { measures?: Array<{ meta?: { tags?: unknown } }> };

/**
 * Renders a chip bar of every tag in the loaded `/meta`. Clicking toggles a
 * tag in the URL (`?tags=a,b`). Selection survives refresh and is shareable.
 * Renders nothing when no tags exist.
 */
export function TagFilterChips() {
  const { cubes } = useQueryBuilderContext();
  const { selectedTags, toggle, clear } = useSelectedTags();

  const allTags = useMemo(() => {
    const seen = new Set<string>();
    for (const cube of cubes as unknown as CubeLike[]) {
      for (const m of cube.measures ?? []) {
        const tags = m.meta?.tags;
        if (!Array.isArray(tags)) continue;
        for (const t of tags) {
          if (typeof t === 'string' && t.trim()) seen.add(t);
        }
      }
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [cubes]);

  if (allTags.length === 0) return null;

  return (
    <Row role="toolbar" aria-label="Filter measures by tag">
      <Label>Tags</Label>
      {allTags.map((tag) => (
        <Chip
          key={tag}
          $active={selectedTags.has(tag)}
          onClick={() => toggle(tag)}
          aria-pressed={selectedTags.has(tag)}
        >
          {tag}
        </Chip>
      ))}
      {selectedTags.size > 0 && (
        <Clear onClick={clear} type="button">
          Clear
        </Clear>
      )}
    </Row>
  );
}
