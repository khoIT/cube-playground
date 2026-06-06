/**
 * Inline notice shown at the top of any tab body that is rendering content
 * from an auto-synthesized preset (no curated bundle for the cube). The visual
 * design is intentionally soft — informative, not alarming — so users know
 * the cards/columns are best-effort defaults rather than hand-tuned insights.
 */

import { ReactElement } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from '../segments.module.css';

interface Props {
  /** Hub cube name (e.g. 'recharge'). Shown so users know which cube the
   *  defaults are derived from. */
  cube: string;
  /** Optional override for the title line (e.g. the identity-pivot variant). */
  titleKey?: string;
  titleDefault?: string;
  /** Optional override for the body sentence (e.g. tighter copy for Members). */
  bodyKey?: string;
  bodyDefault?: string;
}

export function AutoPresetBanner({ cube, titleKey, titleDefault, bodyKey, bodyDefault }: Props): ReactElement {
  const { t } = useTranslation();
  return (
    <div className={styles.autoPresetBanner} role="status">
      <Sparkles size={14} aria-hidden className={styles.autoPresetIcon} />
      <div>
        <strong>
          {t(titleKey ?? 'segments.detail.autoPreset.title', {
            defaultValue: titleDefault ?? 'Auto preset — best-effort defaults',
          })}
        </strong>
        <span className={styles.autoPresetBody}>
          {t(bodyKey ?? 'segments.detail.autoPreset.body', {
            defaultValue:
              bodyDefault ??
              'No curated preset is installed for {{cube}}. These charts and tables are synthesized from Cube metadata. Install a preset for richer insights.',
            cube,
          })}
        </span>
      </div>
    </div>
  );
}
