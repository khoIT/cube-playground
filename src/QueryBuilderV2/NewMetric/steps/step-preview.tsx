import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Button } from '@cube-dev/ui-kit';
import { UseNewMetricDraftReturn } from '../hooks/use-new-metric-draft';
import { useLivePreview } from '../hooks/use-live-preview';
import { useQueryBuilderContext } from '../../context';
import { TimeDimSelect } from '../components/time-dim-select';
import { LivePreviewCard } from '../preview/live-preview-card';

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 320px;
`;

const Row = styled.div`
  display: flex;
  gap: 12px;
  align-items: flex-end;
`;

const RangeRow = styled.div`
  display: flex;
  gap: 6px;
`;

const DangerButtonWrap = styled.div`
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
`;

type CubeLike = {
  name: string;
  dimensions?: Array<{ name: string; type?: string }>;
};

interface StepPreviewProps {
  draftState: UseNewMetricDraftReturn;
  yamlPatch: string;
  enabled: boolean;
}

/**
 * Wizard step 3 — commit-then-preview. Auto-runs whenever the draft changes
 * (debounced inside `useLivePreview`). Discard explicitly removes the new
 * measure from disk and restores `.bak`. Define keeps it (handled in parent).
 */
export function StepPreview({ draftState, yamlPatch, enabled }: StepPreviewProps) {
  const { draft, setField } = draftState;
  const { cubes } = useQueryBuilderContext();

  // Pick the source cube's time-typed dimensions; auto-select the first.
  const timeDimOptions = useMemo(() => {
    const source = (cubes as unknown as CubeLike[]).find(
      (c) => c.name === draft.sourceCube,
    );
    const dims = source?.dimensions ?? [];
    return dims.filter((d) => d.type === 'time').map((d) => d.name);
  }, [cubes, draft.sourceCube]);

  // Initial auto-pick of the time dimension when entering the step.
  useEffect(() => {
    if (enabled && draft.previewTimeDimension == null && timeDimOptions.length > 0) {
      setField('previewTimeDimension', timeDimOptions[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, timeDimOptions.join(',')]);

  const preview = useLivePreview({
    enabled,
    cubeName: draft.sourceCube,
    measureName: draft.name,
    yamlPatch,
    timeDimension: draft.previewTimeDimension,
    range: draft.previewRange,
  });

  const [confirming, setConfirming] = useState(false);

  async function handleDiscard() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    await preview.discard();
  }

  return (
    <Layout>
      <Row>
        <TimeDimSelect
          options={timeDimOptions}
          value={draft.previewTimeDimension}
          onChange={(next) => setField('previewTimeDimension', next)}
        />
        <RangeRow>
          <Button
            type={draft.previewRange === '7d' ? 'primary' : 'secondary'}
            onPress={() => setField('previewRange', '7d')}
          >
            7d
          </Button>
          <Button
            type={draft.previewRange === '30d' ? 'primary' : 'secondary'}
            onPress={() => setField('previewRange', '30d')}
          >
            30d
          </Button>
        </RangeRow>
      </Row>

      <LivePreviewCard
        status={preview.status}
        scalar={preview.scalar}
        series={preview.series}
        error={preview.error}
        measureLabel={draft.title || draft.name || 'Preview'}
        hasTimeDim={!!draft.previewTimeDimension}
      />

      <DangerButtonWrap>
        {confirming ? (
          <>
            <Button type="secondary" onPress={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="primary" onPress={handleDiscard}>
              Confirm Discard
            </Button>
          </>
        ) : (
          <Button type="secondary" onPress={handleDiscard}>
            Discard
          </Button>
        )}
      </DangerButtonWrap>
    </Layout>
  );
}
