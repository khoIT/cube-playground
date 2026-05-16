import styled from 'styled-components';
import { Divider } from '@cube-dev/ui-kit';
import { UseNewMetricDraftReturn } from '../hooks/use-new-metric-draft';
import { SourceSection } from '../sections/source-section';
import { OperationSection } from '../sections/operation-section';
import { OfSection } from '../sections/of-section';
import { FilterSection } from '../sections/filter-section';
import { FindSimilarWarning } from '../components/find-similar-warning';
import { useFindSimilar } from '../hooks/use-find-similar';

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const SectionDivider = styled(Divider)`
  margin: 0;
`;

interface Props {
  draftState: UseNewMetricDraftReturn;
}

/**
 * Wizard step 1 — define the metric: source cube, operation, target member(s),
 * optional filter. FindSimilarWarning slots between Operation and Of so the
 * suggestion appears the moment the user picks an operation on a cube.
 */
export function StepDefine({ draftState }: Props) {
  const { draft, setField } = draftState;
  const similar = useFindSimilar(draft.sourceCube, draft.operation);

  return (
    <Stack>
      <SourceSection draft={draft} setField={setField} />
      <SectionDivider />
      <OperationSection draft={draft} setField={setField} />
      {similar.length > 0 && <FindSimilarWarning matches={similar} />}
      <SectionDivider />
      <OfSection draft={draft} setField={setField} />
      <SectionDivider />
      <FilterSection draft={draft} setField={setField} />
    </Stack>
  );
}
