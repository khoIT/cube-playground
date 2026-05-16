import { Select, Space, Text } from '@cube-dev/ui-kit';
import { Key } from 'react';
import { useReachableMembers, ReachableMember } from '../hooks/use-reachable-members';
import { NewMetricDraft } from '../types';

interface OfSectionProps {
  draft: NewMetricDraft;
  setField: <K extends keyof NewMetricDraft>(field: K, value: NewMetricDraft[K]) => void;
}

/** Build a flat, readable label for a reachable member. */
function memberLabel(item: ReachableMember): string {
  const base = `${item.cubeName}.${item.shortName} (${item.kind})`;
  return item.viaJoin ? `${base} — via ${item.viaJoin.sql}` : base;
}

interface MemberSelectProps {
  ariaLabel: string;
  selectedKey: string | null;
  onSelect: (key: Key) => void;
  items: ReachableMember[];
}

function MemberSelect({ ariaLabel, selectedKey, onSelect, items }: MemberSelectProps) {
  return (
    <Select
      aria-label={ariaLabel}
      placeholder="Select a member…"
      selectedKey={selectedKey ?? undefined}
      onSelectionChange={onSelect}
      size="medium"
    >
      {items.map((item) => {
        const label = memberLabel(item);
        return (
          <Select.Item key={item.memberName} textValue={label}>
            {label}
          </Select.Item>
        );
      })}
    </Select>
  );
}

/**
 * Section 3 — Member picker.
 * Flat list (cube-prefixed) so the kit's typeahead works; the (via …) annotation
 * shows the join SQL inline.
 */
export function OfSection({ draft, setField }: OfSectionProps) {
  const { items } = useReachableMembers(draft.sourceCube);

  const isRatio = draft.operation === 'ratio';
  const isDisabled = !draft.sourceCube;

  // For ratio denominators: restrict to same-cube measures only.
  // Cross-cube ratio is not supported (validator enforces this too).
  const denominatorItems =
    isRatio && draft.sourceCube
      ? items.filter((item) => item.cubeName === draft.sourceCube && item.kind === 'measure')
      : items;

  function handlePrimarySelect(key: Key) {
    setField('ofMember', key as string);
  }

  function handleSecondarySelect(key: Key) {
    setField('ofMemberB', key as string);
  }

  return (
    <Space direction="vertical" gap="1x">
      <Text>Of{isRatio ? ' (numerator)' : ''}</Text>

      {isDisabled ? (
        <Text>Select a source cube first.</Text>
      ) : (
        <MemberSelect
          ariaLabel="Primary member"
          selectedKey={draft.ofMember}
          onSelect={handlePrimarySelect}
          items={items}
        />
      )}

      {isRatio && !isDisabled && (
        <>
          <Text>Divided by (denominator)</Text>
          <MemberSelect
            ariaLabel="Denominator member"
            selectedKey={draft.ofMemberB}
            onSelect={handleSecondarySelect}
            items={denominatorItems}
          />
        </>
      )}
    </Space>
  );
}
