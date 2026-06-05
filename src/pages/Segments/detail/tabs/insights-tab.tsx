/**
 * Insights tab — folds the four preset sub-tabs (Overview/Engagement/
 * Monetization/Retention) plus Saved Analyses into one tab with sub-pills.
 * For non-preset segments, shows an install-preset empty-state.
 */

import { ReactElement, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PresetTab } from './preset-tab';
import { SavedAnalysesTab } from './saved-analyses-tab';
import { SubPills } from './insights/sub-pills';
import { InsightsFreshness } from './insights/insights-freshness';
import { AutoPresetBanner } from '../../components/auto-preset-banner';
import type { Preset } from '../../presets/types';
import type { Segment } from '../../../../types/segment-api';
import styles from '../../segments.module.css';

const PRESET_SECTIONS = ['overview', 'engagement', 'monetization', 'retention'] as const;

interface Props {
  segment: Segment;
  preset: Preset | null;
  section: string | null;
  onSectionChange: (s: string | null) => void;
}

export function InsightsTab({ segment, preset, section, onSectionChange }: Props): ReactElement {
  const { t } = useTranslation();

  const availableSections = useMemo(() => {
    if (!preset) return [];
    const pills: Array<{ key: string; label: string }> = [];
    for (const id of PRESET_SECTIONS) {
      const tab = preset.tabs.find((tt) => tt.id === id);
      if (!tab) continue;
      pills.push({ key: id, label: t(`segments.detail.tabs.${id}`, { defaultValue: tab.label ?? id }) });
    }
    pills.push({ key: 'saved', label: t('segments.detail.tabs.savedAnalyses', { defaultValue: 'Pinned analyses' }) });
    return pills;
  }, [preset, t]);

  // Default section: first preset section, or 'saved' if none.
  useEffect(() => {
    if (availableSections.length === 0) return;
    const known = new Set(availableSections.map((p) => p.key));
    if (!section || !known.has(section)) {
      onSectionChange(availableSections[0].key);
    }
  }, [availableSections, section, onSectionChange]);

  if (!preset) {
    return (
      <div className={styles.insightsEmpty}>
        <h3>{t('segments.detail.insights.empty.title', { defaultValue: 'No insights for this cube' })}</h3>
        <p>{t('segments.detail.insights.empty.body', {
          defaultValue: 'Install a preset for this cube to enable Engagement, Monetization, and Retention insights.',
        })}</p>
      </div>
    );
  }

  const activeId = section ?? availableSections[0]?.key ?? null;

  return (
    <div className={styles.insightsTab}>
      {preset.auto && <AutoPresetBanner cube={preset.hubCube} />}
      {/* Section nav + freshness share one row: pills left, "Updated…" right.
          Keeping freshness on its own line wasted vertical space between the
          main tab strip and the section pills. */}
      <div className={styles.insightsToolbar}>
        <SubPills pills={availableSections} active={activeId} onChange={onSectionChange} />
        <InsightsFreshness segment={segment} />
      </div>
      {activeId === 'saved' ? (
        <SavedAnalysesTab segment={segment} />
      ) : (
        (() => {
          const tab = preset.tabs.find((tt) => tt.id === activeId);
          if (!tab) {
            return (
              <div className={styles.monitorEmpty}>
                {t('segments.detail.insights.noContent', { defaultValue: 'No content for this section.' })}
              </div>
            );
          }
          return <PresetTab tab={tab} segment={segment} preset={preset} />;
        })()
      )}
    </div>
  );
}
