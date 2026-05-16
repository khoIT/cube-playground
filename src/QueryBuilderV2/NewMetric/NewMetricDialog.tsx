import { useState, useMemo } from 'react';
import styled from 'styled-components';
import { notification } from 'antd';
import {
  Button,
  Dialog,
  Divider,
  Header as UIHeader,
  Space,
  Title as UITitle,
} from '@cube-dev/ui-kit';
import { UseNewMetricDraftReturn, validate } from './hooks/use-new-metric-draft';
import { useReachableMembers } from './hooks/use-reachable-members';
import { useMetricYaml } from './hooks/use-metric-yaml';
import { useDryRunSql } from './hooks/use-dry-run-sql';
import { postSchemaWrite } from './api';
import { useAppContext } from '../../hooks';
import { SourceSection } from './sections/source-section';
import { OperationSection } from './sections/operation-section';
import { OfSection } from './sections/of-section';
import { FilterSection } from './sections/filter-section';
import { IdentitySection } from './sections/identity-section';
import { YamlPreview } from './preview/yaml-preview';
import { DryRunSqlPreview } from './preview/dry-run-sql-preview';

// ─── Styled layout ────────────────────────────────────────────────────────────

const Body = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
  height: 100%;
`;

const SectionsPane = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const PreviewPane = styled.div`
  width: 360px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-card);
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--bg-surface);
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 24px;
  border-top: 1px solid var(--border-card);
  background: var(--bg-card);
`;

const SectionDivider = styled(Divider)`
  margin: 0;
`;

// ─── Props ────────────────────────────────────────────────────────────────────

interface NewMetricDialogProps {
  /** Called when the user presses Cancel or after a successful Define. */
  onClose: () => void;
  draftState: UseNewMetricDraftReturn;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Fullscreen wizard dialog — fully wired with live YAML preview, Validate
 * (dry-run SQL), and Define (schema write + meta refetch + toast).
 */
export function NewMetricDialog({ onClose, draftState }: NewMetricDialogProps) {
  const { draft, setField, reset, validation } = draftState;
  const { refreshMeta } = useAppContext();
  const [isSaving, setIsSaving] = useState(false);

  // ── Reachable members for the selected source cube ──────────────────────────
  const { items: reachableMembers, reachableNames } = useReachableMembers(draft.sourceCube);

  // ── Peer measure names on the source cube (for naming-convention inference) ─
  const peerMeasureNames = useMemo(
    () =>
      reachableMembers
        .filter((m) => m.kind === 'measure' && m.cubeName === draft.sourceCube)
        .map((m) => m.shortName),
    [reachableMembers, draft.sourceCube]
  );

  const sourceCube = draft.sourceCube ?? '';

  // ── Live YAML generation ────────────────────────────────────────────────────
  const { yaml, fragment } = useMetricYaml(draft, {
    sourceCube,
    reachableMembers,
    peerMeasureNames,
  });

  // ── Dry-run SQL (Validate) ──────────────────────────────────────────────────
  const dryRun = useDryRunSql({
    draft,
    sourceCube: draft.sourceCube,
    measureName: draft.name,
    fragment,
  });

  // ── Validation (with reachability) ─────────────────────────────────────────
  const fullValidation = validate(draft, { reachableNames });
  const isValid = fullValidation.isValid;

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function handleCancel() {
    reset();
    onClose();
  }

  async function handleValidate() {
    await dryRun.run();
  }

  async function handleDefine() {
    if (!isValid || isSaving || !draft.sourceCube) return;

    setIsSaving(true);
    try {
      // If the dry-run result is stale, run validate first as a guard.
      if (dryRun.isStale) {
        await dryRun.run();
        // If the run produced an error, surface it and abort — the SQL pane
        // already shows the error; we don't block save on it per POC spec.
        // (Phase spec: only abort if dryRun.run() throws, not on a 400 result.)
      }

      const result = await postSchemaWrite({
        cubeName: draft.sourceCube,
        measureName: draft.name,
        yamlPatch: fragment,
      });

      if (result.ok) {
        // Trigger meta re-fetch so the QueryBuilder sidebar reflects the new measure.
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

      // result.ok === false — all error branches carry status + reason
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

  const validateDisabled = !isValid || dryRun.isRunning;
  const defineDisabled = !isValid || dryRun.isRunning || isSaving;

  return (
    <Dialog isDismissable>
      <UIHeader>
        <UITitle>New Metric</UITitle>
      </UIHeader>

      <Body>
        <SectionsPane>
          <SourceSection draft={draft} setField={setField} />
          <SectionDivider />
          <OperationSection draft={draft} setField={setField} />
          <SectionDivider />
          <OfSection draft={draft} setField={setField} />
          <SectionDivider />
          <FilterSection draft={draft} setField={setField} />
          <SectionDivider />
          <IdentitySection draft={draft} setField={setField} validation={fullValidation} />
        </SectionsPane>

        <PreviewPane>
          <YamlPreview
            draft={draft}
            sourceCube={sourceCube}
            reachableMembers={reachableMembers}
            peerMeasureNames={peerMeasureNames}
          />
          <DryRunSqlPreview isRunning={dryRun.isRunning} result={dryRun.result} />
        </PreviewPane>
      </Body>

      <Footer>
        <Button type="secondary" onPress={handleCancel}>
          Cancel
        </Button>
        <Button
          type="secondary"
          isDisabled={validateDisabled}
          onPress={handleValidate}
        >
          {dryRun.isRunning ? 'Validating…' : 'Validate'}
        </Button>
        <Button
          type="primary"
          isDisabled={defineDisabled}
          onPress={handleDefine}
        >
          {isSaving ? 'Saving…' : 'Define'}
        </Button>
      </Footer>
    </Dialog>
  );
}
