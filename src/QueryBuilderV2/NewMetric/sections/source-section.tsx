import { Select, Space, Text } from '@cube-dev/ui-kit';
import { Key } from 'react';
import { useQueryBuilderContext } from '../../context';
import { useReachableMembers } from '../hooks/use-reachable-members';
import { NewMetricDraft } from '../types';

interface SourceSectionProps {
  draft: NewMetricDraft;
  setField: <K extends keyof NewMetricDraft>(field: K, value: NewMetricDraft[K]) => void;
}

/**
 * Section 1 — Source cube picker.
 * Reads available cubes from QueryBuilderContext (already loaded meta).
 * Selecting a new cube clears ofMember / ofMemberB to avoid stale state.
 */
export function SourceSection({ draft, setField }: SourceSectionProps) {
  const { cubes } = useQueryBuilderContext();
  const { joinedCubeCount } = useReachableMembers(draft.sourceCube);

  function handleSelect(key: Key) {
    const newCube = key as string;
    if (newCube !== draft.sourceCube) {
      setField('sourceCube', newCube);
      // Reset member selections when cube changes
      setField('ofMember', null);
      setField('ofMemberB', null);
    }
  }

  return (
    <Space direction="vertical" gap="1x">
      <Text>Source cube</Text>
      <Select
        aria-label="Source cube"
        placeholder="Select a cube…"
        selectedKey={draft.sourceCube ?? undefined}
        onSelectionChange={handleSelect}
        size="medium"
      >
        {cubes.map((cube) => {
          const label = cube.title ?? cube.name;
          return (
            <Select.Item key={cube.name} textValue={label}>
              {label}
            </Select.Item>
          );
        })}
      </Select>
      {draft.sourceCube && joinedCubeCount > 0 && (
        <Text>
          {joinedCubeCount} joined {joinedCubeCount === 1 ? 'cube' : 'cubes'}
        </Text>
      )}
    </Space>
  );
}
