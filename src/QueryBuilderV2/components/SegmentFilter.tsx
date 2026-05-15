import { Space, tasty } from '@cube-dev/ui-kit';
import { TCubeSegment } from '@cubejs-client/core';

import { useEvent } from '../hooks';
import { MemberViewType } from '../types';

import { FilterLabel } from './FilterLabel';
import { FilterOptionsAction, FilterOptionsButton } from './FilterOptionsButton';

interface MemberFilterProps {
  name: string;
  member: TCubeSegment;
  memberName: string;
  memberTitle?: string;
  cubeName: string;
  cubeTitle?: string;
  memberViewType?: MemberViewType;
  isMissing?: boolean;
  isCompact?: boolean;
  onRemove: () => void;
}

const SegmentFilterWrapper = tasty(Space, {
  qa: 'SegmentFilter',
  styles: {
    gap: '.5x',
    flow: 'row wrap',
    placeItems: 'center',
    radius: true,
    fill: {
      '': '#clear',
      ':has(>[data-qa="FilterOptionsButton"][data-is-hovered])': '#light',
    },
    padding: '.25x .5x',
    width: 'max-content',
  },
});

export function SegmentFilter(props: MemberFilterProps) {
  const {
    member,
    cubeName,
    cubeTitle,
    memberName,
    memberTitle,
    memberViewType,
    name,
    isMissing,
    isCompact,
    onRemove,
  } = props;

  const onAction = useEvent((key: FilterOptionsAction) => {
    switch (key) {
      case 'remove':
        onRemove();
        break;
      default:
        break;
    }
  });

  return (
    <SegmentFilterWrapper>
      <FilterOptionsButton type="dateRange" onAction={onAction} />

      <FilterLabel
        size="small"
        isCompact={isCompact}
        isMissing={isMissing}
        memberName={memberName}
        memberTitle={memberTitle}
        cubeName={cubeName}
        cubeTitle={cubeTitle}
        memberViewType={memberViewType}
        type="filter"
        member="segment"
        name={name}
      />
    </SegmentFilterWrapper>
  );
}
