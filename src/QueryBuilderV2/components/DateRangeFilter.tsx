import { Key, useCallback, useState } from 'react';
import { Item, Select, Space, tasty, Text } from '@cube-dev/ui-kit';
import { DateRange, TimeDimension } from '@cubejs-client/core';
import formatDate from 'date-fns/format';

import { capitalize } from '../utils/capitalize';
import { DATA_RANGES } from '../values';
import { useEvent } from '../hooks';
import { MemberViewType } from '../types';

import { FilterLabel } from './FilterLabel';
import { TimeDateRangeSelector } from './TimeDateRangeSelector';
import { FilterOptionsAction, FilterOptionsButton } from './FilterOptionsButton';

interface TimeDimensionFilterProps {
  name: string;
  member: TimeDimension;
  memberName?: string;
  memberTitle?: string;
  cubeName?: string;
  cubeTitle?: string;
  memberViewType?: MemberViewType;
  isCompact?: boolean;
  isMissing?: boolean;
  onChange: (dateRange?: DateRange) => void;
  onRemove: () => void;
}

const DateRangeFilterWrapper = tasty(Space, {
  qa: 'DateRangeFilter',
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

export function DateRangeFilter(props: TimeDimensionFilterProps) {
  const {
    member,
    isCompact,
    isMissing,
    name,
    cubeName,
    cubeTitle,
    memberName,
    memberTitle,
    onRemove,
    onChange,
  } = props;
  const [open, setOpen] = useState(false);

  // const onGranularityChange = useCallback(
  //   (granularity?: Key) => {
  //     if (granularity === 'w/o grouping') {
  //       onChange({ ...member, granularity: undefined });
  //     } else {
  //       onChange({ ...member, granularity: granularity as TimeDimensionGranularity });
  //     }
  //   },
  //   [onChange]
  // );

  const onDateRangeChange = useCallback(
    (dateRange?: Key) => {
      if (dateRange === 'custom') {
        onChange([formatDate(new Date(), 'yyyy-MM-dd'), formatDate(new Date(), 'yyyy-MM-dd')]);

        return;
      }

      if (dateRange === 'all time') {
        onChange(undefined);
      } else {
        onChange(dateRange as string);
      }
    },
    [onChange]
  );

  const onDataRangeChangeInPicker = useCallback(
    (dateRange: [string, string]) => {
      onChange(dateRange);
    },
    [onChange]
  );

  const onOpenChange = (open: boolean) => {
    setOpen(open);
  };

  const onAction = useEvent((key: FilterOptionsAction) => {
    if (key === 'remove') {
      onRemove();
    }
  });

  // Normalize the dateRange string for Select.selectedKey matching.
  // Arrays use the synthetic 'custom' key (handled elsewhere); strings are
  // lowercased to match DATA_RANGES entries.
  const dateRangeKey =
    !Array.isArray(member.dateRange) && typeof member.dateRange === 'string' && member.dateRange
      ? member.dateRange.toLowerCase()
      : null;
  // True when the string is set but unknown to our preset list — Cube still
  // accepts arbitrary relative ranges (e.g. "last 3 months") so we surface
  // them as an ad-hoc Select item rather than letting the chip look empty.
  const showAdHocItem = dateRangeKey != null && !DATA_RANGES.includes(dateRangeKey);

  return (
    <DateRangeFilterWrapper>
      <FilterOptionsButton type="dateRange" onAction={onAction} />

      <FilterLabel
        size="small"
        isCompact={isCompact}
        isMissing={isMissing}
        type="time"
        member="timeDimension"
        memberName={memberName}
        memberTitle={memberTitle}
        cubeName={cubeName}
        cubeTitle={cubeTitle}
        memberViewType={props.memberViewType}
        name={member.dimension}
      />
      <Text>for</Text>
      <Select
        aria-label="Date range preset"
        size="small"
        placeholder="Select range"
        validationState={!open && !member.dateRange ? 'invalid' : undefined}
        // @ts-ignore
        selectedKey={
          Array.isArray(member.dateRange) ? 'custom' : (dateRangeKey as Key)
        }
        onSelectionChange={onDateRangeChange}
        onOpenChange={onOpenChange}
      >
        {/*
          Prepend an ad-hoc item when the query supplies a relative-range
          string Cube accepts (e.g. "last 3 months") but our preset list
          doesn't include — otherwise the Select shows its placeholder
          and the filter looks empty while still narrowing results.
        */}
        {(showAdHocItem ? [dateRangeKey!, ...DATA_RANGES] : DATA_RANGES).map((range) => {
          return (
            <Item key={range} textValue={capitalize(range)}>
              <Text preset="t3m">{capitalize(range)}</Text>
            </Item>
          );
        })}
      </Select>
      {Array.isArray(member.dateRange) ? (
        <TimeDateRangeSelector value={member.dateRange} onChange={onDataRangeChangeInPicker} />
      ) : undefined}
      {/*<Text>by</Text>*/}
      {/*<Select*/}
      {/*  size="small"*/}
      {/*  selectedKey={member.granularity || GRANULARITIES[0]}*/}
      {/*  onSelectionChange={onGranularityChange}*/}
      {/*>*/}
      {/*  {GRANULARITIES.map((key) => {*/}
      {/*    return (*/}
      {/*      <Item key={key} textValue={capitalize(key)}>*/}
      {/*        <Text preset="t3m">{capitalize(key)}</Text>*/}
      {/*      </Item>*/}
      {/*    );*/}
      {/*  })}*/}
      {/*</Select>*/}
    </DateRangeFilterWrapper>
  );
}
