/**
 * Step 2 — Conversion window picker.
 *
 * Presets: 1h / 24h / 7d / 30d — plus a custom number-of-days input.
 * Output: windowMs (milliseconds), consumed by run-funnel.ts to build the
 * dateRange filter sent to Cube.
 */

import type { ReactElement } from 'react';
import styles from './funnel-builder.module.css';

export interface WindowPreset {
  label: string;
  ms: number;
}

export const WINDOW_PRESETS: WindowPreset[] = [
  { label: '1 hour',   ms: 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days',   ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days',  ms: 30 * 24 * 60 * 60 * 1000 },
];

const CUSTOM_SENTINEL = -1;

interface Props {
  windowMs: number;
  onChange: (ms: number) => void;
}

function msToReadable(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''}`;
  const days = hours / 24;
  return `${days} day${days !== 1 ? 's' : ''}`;
}

export function StepWindow({ windowMs, onChange }: Props): ReactElement {
  // Determine if current value matches a preset or is custom
  const matchedPreset = WINDOW_PRESETS.find((p) => p.ms === windowMs) ?? null;
  const isCustom = matchedPreset === null;

  // Custom days input — derive from windowMs when in custom mode
  const customDays = isCustom ? Math.round(windowMs / (24 * 60 * 60 * 1000)) || 1 : 1;

  const handlePreset = (ms: number) => onChange(ms);

  const handleCustomDays = (raw: string) => {
    const days = Math.max(1, Math.min(365, parseInt(raw, 10) || 1));
    onChange(days * 24 * 60 * 60 * 1000);
  };

  const handleCustomToggle = () => {
    // Switch to custom: keep current windowMs if already custom, else default 3d
    if (!isCustom) {
      onChange(3 * 24 * 60 * 60 * 1000);
    }
  };

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>Conversion window</h3>
      <p className={styles.cardDesc}>
        Users must complete all steps within this time window to be counted.
      </p>

      <div className={styles.windowPresets} role="radiogroup" aria-label="Window presets">
        {WINDOW_PRESETS.map((preset) => (
          <button
            key={preset.ms}
            type="button"
            role="radio"
            aria-checked={!isCustom && windowMs === preset.ms}
            className={[
              styles.windowPreset,
              !isCustom && windowMs === preset.ms ? styles.windowPresetActive : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => handlePreset(preset.ms)}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={isCustom}
          className={[
            styles.windowPreset,
            isCustom ? styles.windowPresetActive : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={handleCustomToggle}
        >
          Custom
        </button>
      </div>

      {isCustom && (
        <div className={styles.windowCustomRow}>
          <input
            type="number"
            className={styles.windowCustomInput}
            min={1}
            max={365}
            value={customDays}
            onChange={(e) => handleCustomDays(e.target.value)}
            aria-label="Custom window in days"
          />
          <span className={styles.windowCustomLabel}>days</span>
        </div>
      )}

      <p className={styles.windowSummary} aria-live="polite">
        Window: {msToReadable(windowMs)}
      </p>
    </div>
  );
}
