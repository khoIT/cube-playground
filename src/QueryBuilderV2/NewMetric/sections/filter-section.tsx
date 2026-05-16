import { Button, Space, Text } from '@cube-dev/ui-kit';
import { useMemo } from 'react';
import { BinaryFilter, Filter, TCubeMemberType, UnaryFilter } from '@cubejs-client/core';
import { useQueryBuilderContext } from '../../context';
import { FilterMember } from '../../components/FilterMember';
import { NewMetricDraft } from '../types';

interface FilterSectionProps {
  draft: NewMetricDraft;
  setField: <K extends keyof NewMetricDraft>(field: K, value: NewMetricDraft[K]) => void;
}

// Default blank filter anchored to the source cube's first dimension
const DEFAULT_OPERATOR = 'equals';

/**
 * Section 4 — Optional single filter row.
 * Reuses the existing FilterMember component; wraps one BinaryFilter|UnaryFilter
 * or null into draft.filter.
 */
export function FilterSection({ draft, setField }: FilterSectionProps) {
  const { cubes, members } = useQueryBuilderContext();

  // Candidate members for the filter picker — same-cube dimensions + measures
  const firstDimension = useMemo(() => {
    if (!draft.sourceCube) return null;
    const cube = cubes.find((c) => c.name === draft.sourceCube);
    return cube?.dimensions[0] ?? null;
  }, [cubes, draft.sourceCube]);

  const activeFilter = draft.filter as BinaryFilter | UnaryFilter | null;

  // Resolve metadata for the current filter's member
  const filterMemberName = activeFilter && 'member' in activeFilter ? activeFilter.member : null;
  const filterMemberMeta = filterMemberName
    ? (members.dimensions[filterMemberName] ?? members.measures[filterMemberName] ?? null)
    : null;

  function handleAddFilter() {
    if (!firstDimension) return;
    const blank: BinaryFilter = {
      member: firstDimension.name,
      operator: DEFAULT_OPERATOR,
      values: [],
    };
    setField('filter', blank);
  }

  function handleChange(updated: Filter) {
    // FilterMember may wrap in logical filter; we only support flat binary/unary here
    if ('and' in updated || 'or' in updated) return;
    setField('filter', updated as BinaryFilter | UnaryFilter);
  }

  function handleRemove() {
    setField('filter', null);
  }

  const isDisabled = !draft.sourceCube;

  return (
    <Space direction="vertical" gap="1x">
      <Text preset="t3m">Filter (optional)</Text>

      {isDisabled && (
        <Text preset="t3" style={{ color: 'var(--text-secondary)' }}>
          Select a source cube first.
        </Text>
      )}

      {!isDisabled && !activeFilter && (
        <Button size="small" onPress={handleAddFilter} isDisabled={!firstDimension}>
          + Add filter
        </Button>
      )}

      {!isDisabled && activeFilter && (
        <FilterMember
          filter={activeFilter}
          cubeName={filterMemberMeta?.name?.split('.')[0]}
          cubeTitle={filterMemberMeta?.name?.split('.')[0]}
          memberName={filterMemberMeta?.shortTitle ?? filterMemberMeta?.title}
          memberTitle={filterMemberMeta?.shortTitle ?? filterMemberMeta?.title}
          memberType={filterMemberMeta ? ('dimension' in filterMemberMeta ? 'dimension' : 'measure') : 'dimension'}
          type={(filterMemberMeta?.type ?? 'string') as TCubeMemberType}
          onChange={handleChange}
          onRemove={handleRemove}
        />
      )}
    </Space>
  );
}
