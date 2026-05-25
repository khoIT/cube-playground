/**
 * Funnel builder wizard — /segments/new/funnel
 *
 * 3-step wizard:
 *   Step 1: Events picker   (StepEvents)
 *   Step 2: Window picker   (StepWindow)
 *   Step 3: Result + Save   (StepResult)
 *
 * Detection gate:
 *   - Loading  → spinner placeholder
 *   - Error    → error banner (no wizard)
 *   - Absent   → informative empty-state pointing to the template doc
 *   - Found    → render the wizard against the detected cube
 *
 * FunnelDefinition is the serialisable shape stored in segments.funnel_json.
 */

import { ReactElement, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Button } from 'antd';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Breadcrumbs } from '../visuals';
import { useFunnelDetection } from './use-funnel-detection';
import { StepEvents, MIN_EVENTS, MAX_EVENTS } from './step-events';
import { StepWindow, WINDOW_PRESETS } from './step-window';
import { StepResult } from './step-result';
import styles from './funnel-builder.module.css';

export interface FunnelDefinition {
  orderedEvents: string[];
  windowMs: number;
}

type WizardStep = 1 | 2 | 3;

const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Events',
  2: 'Window',
  3: 'Results',
};

function stepIsValid(step: WizardStep, def: FunnelDefinition): boolean {
  if (step === 1) return def.orderedEvents.length >= MIN_EVENTS && def.orderedEvents.length <= MAX_EVENTS;
  if (step === 2) return def.windowMs > 0;
  return true;
}

/** Empty-state shown when no ordered-funnel cube is detected. */
function NoOrderedCubeState(): ReactElement {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyStateIcon} aria-hidden>⚗️</span>
      <h2 className={styles.emptyStateTitle}>No events cube available</h2>
      <p className={styles.emptyStateBody}>
        The funnel builder requires an <strong>ordered event funnel</strong> cube in your Cube
        backend. Your current schema only contains daily-aggregate cubes (
        <code>active_daily</code>, <code>mf_users</code>, <code>recharge</code>), which do not
        carry per-event semantics needed for ordered funnel analysis.
      </p>
      <p className={styles.emptyStateBody}>
        To enable funnels, deploy the{' '}
        <a
          className={styles.emptyStateLink}
          href="/docs/ordered-funnel-cube-template.md"
          target="_blank"
          rel="noreferrer"
        >
          ordered_event_funnel cube template
        </a>{' '}
        from <code>docs/ordered-funnel-cube-template.md</code> into your Cube backend and restart.
        The playground will automatically detect it and unlock this wizard.
      </p>
      <p className={styles.emptyStateBody} style={{ fontSize: 12 }}>
        <em>
          Multi-query fallback (unordered) is not available in this build — it would produce
          misleading funnel shapes against daily-aggregate data.
        </em>
      </p>
    </div>
  );
}

export function FunnelBuilder(): ReactElement {
  const history = useHistory();
  const detection = useFunnelDetection();

  const [step, setStep] = useState<WizardStep>(1);
  const [definition, setDefinition] = useState<FunnelDefinition>({
    orderedEvents: [],
    windowMs: WINDOW_PRESETS[1].ms, // 24h default
  });

  const goBack = () => {
    if (step > 1) setStep((s) => (s - 1) as WizardStep);
    else history.push('/segments');
  };

  const goNext = () => {
    if (step < 3) setStep((s) => (s + 1) as WizardStep);
  };

  const canAdvance = stepIsValid(step, definition);

  const breadcrumbs = [
    { label: 'Segments', href: '/segments' },
    { label: 'New funnel' },
  ];

  return (
    <main className={styles.wizard}>
      <Breadcrumbs items={breadcrumbs} />

      <header className={styles.wizardHeader}>
        <h1 className={styles.wizardTitle}>Funnel builder</h1>
        {detection.status === 'found' && (
          <span className={`${styles.detectionBadge} ${styles.detectionBadgeOrdered}`}>
            Ordered · single query
          </span>
        )}
      </header>

      {/* Step progress strip */}
      {detection.status === 'found' && (
        <div className={styles.stepStrip} role="navigation" aria-label="Wizard steps">
          {([1, 2, 3] as WizardStep[]).map((s, i) => (
            <span key={s}>
              {i > 0 && <span className={styles.stepSep} aria-hidden />}
              <span
                className={[
                  styles.stepItem,
                  s === step ? styles.stepItemActive : '',
                  s < step ? styles.stepItemDone : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span
                  className={[
                    styles.stepNum,
                    s === step ? styles.stepNumActive : '',
                    s < step ? styles.stepNumDone : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-hidden
                >
                  {s < step ? '✓' : s}
                </span>
                {STEP_LABELS[s]}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Gate: loading */}
      {detection.status === 'loading' && (
        <div className={styles.card}>
          <p className={styles.cardDesc}>Detecting funnel cube…</p>
        </div>
      )}

      {/* Gate: error reaching Cube */}
      {detection.status === 'error' && (
        <div className={styles.errorBanner} role="alert">
          <strong>Could not connect to Cube:</strong>&nbsp;{detection.message}
        </div>
      )}

      {/* Gate: no ordered cube found */}
      {detection.status === 'absent' && <NoOrderedCubeState />}

      {/* Wizard steps */}
      {detection.status === 'found' && (
        <>
          {step === 1 && (
            <StepEvents
              cubeName={detection.cubeName}
              events={definition.orderedEvents}
              onChange={(orderedEvents) => setDefinition((d) => ({ ...d, orderedEvents }))}
            />
          )}
          {step === 2 && (
            <StepWindow
              windowMs={definition.windowMs}
              onChange={(windowMs) => setDefinition((d) => ({ ...d, windowMs }))}
            />
          )}
          {step === 3 && (
            <StepResult cubeName={detection.cubeName} definition={definition} />
          )}

          {/* Navigation footer — hidden on Step 3 (StepResult owns its actions) */}
          {step < 3 && (
            <div className={styles.navRow}>
              <Button size="small" icon={<ChevronLeft size={14} />} onClick={goBack}>
                {step === 1 ? 'Cancel' : 'Back'}
              </Button>
              <span className={styles.navSpacer} />
              {!canAdvance && step === 1 && (
                <span className={styles.validationMsg}>
                  Add at least {MIN_EVENTS} events to continue.
                </span>
              )}
              <Button
                type="primary"
                size="small"
                disabled={!canAdvance}
                onClick={goNext}
              >
                {step === 2 ? 'Run funnel' : 'Next'}&nbsp;<ChevronRight size={14} style={{ verticalAlign: 'middle' }} />
              </Button>
            </div>
          )}
          {step === 3 && (
            <div className={styles.navRow}>
              <Button
                size="small"
                icon={<ChevronLeft size={14} />}
                onClick={() => setStep(2)}
              >
                Back
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default FunnelBuilder;
