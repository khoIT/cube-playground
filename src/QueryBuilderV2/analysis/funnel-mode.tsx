import { useMemo, useState } from 'react';
import { Alert, Tag } from 'antd';
import { Flow, Paragraph, Title, tasty } from '@cube-dev/ui-kit';

import { useQueryBuilderContext } from '../context';

import { FunnelInputs } from './funnel-inputs';
import { useFunnelQueries } from './use-funnel-queries';
import { useOrderedFunnelQuery } from './use-ordered-funnel-query';
import { detectOrderedFunnelCube } from './detect-ordered-funnel';
import { EmptyState } from './empty-state';
import { detectEventDim, detectSampleCube, fetchEventSamples } from './sample-detector';
import { FunnelResults } from './funnel-results';

const HeaderRow = tasty({
  styles: {
    display: 'flex',
    placeItems: 'center start',
    gap: '1x',
  },
});

export function FunnelMode() {
  const { query, cubeApi, joinableMembers, meta, usedCubes } = useQueryBuilderContext();

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

  const [eventDim, setEventDim] = useState<string | undefined>(() => {
    return eventDimOptions.find((d: any) => /event/i.test(d.name))?.name;
  });
  const [measure, setMeasure] = useState<string | undefined>(() => {
    return (
      measureOptions.find((m: any) => /\.count$/i.test(m.name))?.name ?? measureOptions[0]?.name
    );
  });
  const [steps, setSteps] = useState<string[]>([]);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const sampleCube = useMemo(() => detectSampleCube(meta, usedCubes), [meta, usedCubes]);
  const sampleEventDim = useMemo(() => detectEventDim(sampleCube), [sampleCube]);
  const orderedCube = useMemo(() => detectOrderedFunnelCube(meta), [meta]);

  const cleanedSteps = steps.map((s) => s.trim()).filter(Boolean);

  const handleTrySample = async () => {
    if (!sampleEventDim || !cubeApi) return;
    setSampleError(null);
    try {
      const samples = await fetchEventSamples(cubeApi, sampleEventDim, 3);

      if (samples.length === 0) {
        setSampleError('No event values found in the sample cube.');
        return;
      }
      setEventDim(sampleEventDim);
      setSteps(samples.length < 2 ? [...samples, ''] : samples);
    } catch (err: any) {
      setSampleError(err?.message ?? String(err));
    }
  };

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

  const isEmpty = steps.length === 0 && !eventDim;

  if (isEmpty) {
    return (
      <EmptyState
        title="Funnel"
        description={
          orderedCube
            ? 'Track drop-off across an ordered sequence of events (single-query ordered semantics).'
            : 'Track drop-off across an ordered sequence of events. Measures unique users having all chosen events (multi-query).'
        }
        helpBullets={[
          orderedCube
            ? 'Ordered template cube detected — single-query path active.'
            : 'Pick the event-type dimension and a count measure.',
          'Add 2+ step values in the order users should pass through.',
          'Try sample fills inputs from the first detected event cube.',
        ]}
        onTrySample={handleTrySample}
        canTrySample={!!sampleEventDim && !!cubeApi}
        disabledReason="No event-style dimension detected in the current schema."
      />
    );
  }

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
      {sampleError && <Alert type="error" message={sampleError} closable onClose={() => setSampleError(null)} />}
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
