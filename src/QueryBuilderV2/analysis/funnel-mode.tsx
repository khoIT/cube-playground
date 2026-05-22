import { useMemo, useState } from 'react';
import { Tag } from 'antd';
import { Flow, Paragraph, Title, tasty } from '@cube-dev/ui-kit';

import { useQueryBuilderContext } from '../context';

import { FunnelInputs } from './funnel-inputs';
import { useFunnelQueries } from './use-funnel-queries';
import { useOrderedFunnelQuery } from './use-ordered-funnel-query';
import { detectOrderedFunnelCube } from './detect-ordered-funnel';
import { FunnelResults } from './funnel-results';

const HeaderRow = tasty({
  styles: {
    display: 'flex',
    placeItems: 'center start',
    gap: '1x',
  },
});

export function FunnelMode() {
  const { query, cubeApi, joinableMembers, meta } = useQueryBuilderContext();

  const eventDimOptions = useMemo(
    () =>
      Object.values(joinableMembers.dimensions).filter(
        (d: any) => d?.type === 'string' || d?.type === 'number'
      ) as any[],
    [joinableMembers]
  );
  const measureOptions = useMemo(
    () => Object.values(joinableMembers.measures) as any[],
    [joinableMembers]
  );

  // Pre-fill from the current query: prefer a dimension the user is already
  // pivoting on if it looks event-shaped, else fall back to schema scan.
  const queryEventDim = useMemo(
    () =>
      (query.dimensions ?? []).find((d) =>
        eventDimOptions.some((opt: any) => opt.name === d) && /event|action/i.test(d)
      ),
    [query.dimensions, eventDimOptions]
  );
  const queryCountMeasure = useMemo(
    () => (query.measures ?? []).find((m) => /\.count$/i.test(m) || /count_distinct/i.test(m)),
    [query.measures]
  );

  const [eventDim, setEventDim] = useState<string | undefined>(() => {
    return (
      queryEventDim ??
      eventDimOptions.find((d: any) => /event|action/i.test(d.name))?.name
    );
  });
  const [measure, setMeasure] = useState<string | undefined>(() => {
    return (
      queryCountMeasure ??
      measureOptions.find((m: any) => /\.count$/i.test(m.name))?.name ??
      measureOptions[0]?.name
    );
  });
  const [steps, setSteps] = useState<string[]>([]);

  const orderedCube = useMemo(() => detectOrderedFunnelCube(meta), [meta]);

  const cleanedSteps = steps.map((s) => s.trim()).filter(Boolean);

  const multi = useFunnelQueries({
    cubeApi,
    eventDim: orderedCube ? undefined : eventDim,
    measure: orderedCube ? undefined : measure,
    steps: cleanedSteps,
    globalFilters: query.filters,
  });

  const ordered = useOrderedFunnelQuery({
    cubeApi,
    orderedCube,
    steps: cleanedSteps,
    globalFilters: query.filters,
  });

  const { isLoading, error, failedStepIndex, results } = orderedCube ? ordered : multi;

  return (
    <Flow gap="1.5x">
      <HeaderRow>
        <Title level={5} preset="t3">Funnel</Title>
        {orderedCube ? (
          <Tag color="purple">Ordered · single query</Tag>
        ) : (
          <>
            <Tag color="default">All-events · multi-query</Tag>
            <Paragraph color="#dark-03" preset="c2">
              Enable ordered funnels by deploying{' '}
              <code>docs/ordered-funnel-cube-template.md</code>.
            </Paragraph>
          </>
        )}
      </HeaderRow>
      <FunnelInputs
        eventDim={eventDim}
        measure={measure}
        steps={steps}
        eventDimOptions={eventDimOptions}
        measureOptions={measureOptions}
        onEventDimChange={setEventDim}
        onMeasureChange={setMeasure}
        onStepsChange={setSteps}
      />
      {cleanedSteps.length < 2 ? (
        <Paragraph color="#dark-03">Add at least 2 steps to compute a funnel.</Paragraph>
      ) : !orderedCube && (!eventDim || !measure) ? (
        <Paragraph color="#dark-03">Pick an event dimension and a measure to run the funnel.</Paragraph>
      ) : (
        <FunnelResults
          isLoading={isLoading}
          error={error}
          failedStepIndex={failedStepIndex}
          results={results}
        />
      )}
    </Flow>
  );
}
