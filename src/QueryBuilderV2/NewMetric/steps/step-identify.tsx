import styled from 'styled-components';
import { UseNewMetricDraftReturn } from '../hooks/use-new-metric-draft';
import { ValidationResult } from '../types';
import { IdentitySection } from '../sections/identity-section';

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

interface Props {
  draftState: UseNewMetricDraftReturn;
  validation: ValidationResult;
}

/**
 * Wizard step 2 — name, title, description, tags, format. P4 adds the
 * TagCombo input below the description inside IdentitySection.
 */
export function StepIdentify({ draftState, validation }: Props) {
  const { draft, setField } = draftState;
  return (
    <Stack>
      <IdentitySection draft={draft} setField={setField} validation={validation} />
    </Stack>
  );
}
