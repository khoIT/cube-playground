import { useState, useMemo } from 'react';
import styled from 'styled-components';
import { notification } from 'antd';
import { Dialog, Header as UIHeader, Title as UITitle } from '@cube-dev/ui-kit';
import { UseNewMetricDraftReturn, validate } from './hooks/use-new-metric-draft';
import { useReachableMembers } from './hooks/use-reachable-members';
import { useMetricYaml } from './hooks/use-metric-yaml';
import {
  useWizardNavigation,
  WizardStep,
} from './hooks/use-wizard-navigation';
import { postSchemaWrite } from './api';
import { useAppContext } from '../../hooks';
import { Stepper, StepperItem } from './components/stepper';
import { WizardFooter } from './components/wizard-footer';
import { StepDefine } from './steps/step-define';
import { StepIdentify } from './steps/step-identify';
import { StepPreview } from './steps/step-preview';
import { YamlPreview } from './preview/yaml-preview';

// ─── Styled layout ────────────────────────────────────────────────────────────

const Shell = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-card);
`;

const Body = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`;

const MainPane = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 24px;
`;

const RightRail = styled.aside`
  width: 360px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-card);
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--bg-muted);
`;

// ─── Steps definition ─────────────────────────────────────────────────────────

const STEPS: StepperItem[] = [
  { id: 1, label: 'Define' },
  { id: 2, label: 'Identify' },
  { id: 3, label: 'Preview' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface NewMetricDialogProps {
  /** Called when the user presses Cancel or after a successful Define. */
  onClose: () => void;
  draftState: UseNewMetricDraftReturn;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * 3-step wizard modal: Define → Identify → Preview.
 * Step shell rebuilt in Phase 3; Live Preview content arrives in Phase 5.
 */
export function NewMetricDialog({ onClose, draftState }: NewMetricDialogProps) {
  const { draft, reset } = draftState;
  const { refreshMeta } = useAppContext();
  const [isSaving, setIsSaving] = useState(false);

  // ── Reachable members for the selected source cube ──────────────────────────
  const { items: reachableMembers, reachableNames } = useReachableMembers(
    draft.sourceCube,
  );

  // ── Peer measure names on the source cube (for naming-convention inference) ─
  const peerMeasureNames = useMemo(
    () =>
      reachableMembers
        .filter((m) => m.kind === 'measure' && m.cubeName === draft.sourceCube)
        .map((m) => m.shortName),
    [reachableMembers, draft.sourceCube],
  );

  const sourceCube = draft.sourceCube ?? '';

  // ── Live YAML generation (preview rail) ─────────────────────────────────────
  const { fragment } = useMetricYaml(draft, {
    sourceCube,
    reachableMembers,
    peerMeasureNames,
  });

  // ── Full validation (with reachability) ─────────────────────────────────────
  const fullValidation = validate(draft, { reachableNames });
  const isValid = fullValidation.isValid;

  // ── Step state ──────────────────────────────────────────────────────────────
  const {
    currentStep,
    canGoBack,
    canGoNext,
    goNext,
    goBack,
    gotoStep,
    isStepValid,
  } = useWizardNavigation(fullValidation);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function handleCancel() {
    reset();
    onClose();
  }

  async function handleDefine() {
    if (!isValid || isSaving || !draft.sourceCube) return;

    setIsSaving(true);
    try {
      const result = await postSchemaWrite({
        cubeName: draft.sourceCube,
        measureName: draft.name,
        yamlPatch: fragment,
      });

      if (result.ok) {
        await refreshMeta();

        if (result.warning === 'meta-not-acknowledged') {
          notification.warning({
            message: `${draft.name} written to ${draft.sourceCube}`,
            description:
              'Cube has not acknowledged the change within 15s. The file is kept; the measure should appear shortly. If not, restart Cube or `git checkout` to revert.',
          });
        } else {
          notification.success({
            message: `${draft.name} added to ${draft.sourceCube}`,
          });
        }

        reset();
        onClose();
        return;
      }

      const { status, reason } = result as { ok: false; status: number; reason: string };

      if (status === 409) {
        notification.warning({
          message: 'Cube file changed externally — reopen the wizard',
        });
        return;
      }

      if (status === 504) {
        notification.error({
          message: 'Hot-reload timed out; changes were rolled back',
          description: reason,
        });
        return;
      }

      notification.error({
        message: `Save failed (${status})`,
        description: reason,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notification.error({ message: 'Unexpected error', description: msg });
    } finally {
      setIsSaving(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const defineDisabled = !isValid || isSaving;
  const defineLabel = isSaving ? 'Saving…' : 'Define';

  return (
    <Dialog isDismissable>
      <UIHeader>
        <UITitle>New metric</UITitle>
      </UIHeader>

      <Shell>
        <Stepper
          steps={STEPS}
          current={currentStep}
          isStepValid={isStepValid}
          onStepClick={(s: WizardStep) => gotoStep(s)}
        />

        <Body>
          <MainPane>
            {currentStep === 1 && <StepDefine draftState={draftState} />}
            {currentStep === 2 && (
              <StepIdentify draftState={draftState} validation={fullValidation} />
            )}
            {currentStep === 3 && (
              <StepPreview
                draftState={draftState}
                yamlPatch={fragment}
                enabled={currentStep === 3}
              />
            )}
          </MainPane>

          <RightRail>
            <YamlPreview
              draft={draft}
              sourceCube={sourceCube}
              reachableMembers={reachableMembers}
              peerMeasureNames={peerMeasureNames}
            />
          </RightRail>
        </Body>

        <WizardFooter
          currentStep={currentStep}
          canGoBack={canGoBack}
          canGoNext={canGoNext}
          isDefineDisabled={defineDisabled}
          defineLabel={defineLabel}
          onCancel={handleCancel}
          onBack={goBack}
          onNext={goNext}
          onDefine={handleDefine}
        />
      </Shell>
    </Dialog>
  );
}
