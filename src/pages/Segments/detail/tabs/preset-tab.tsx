/**
 * Generic preset-tab renderer. Takes a TabDef + segment + preset and renders
 * a KPI grid followed by the declared cards. Each card maps to its
 * card-component based on the `kind` discriminator.
 */

import { ReactElement } from 'react';
import { KpiCard } from '../cards/kpi-card';
import { LineChartCard } from '../cards/line-chart-card';
import { BarListCard } from '../cards/bar-list-card';
import { DonutCard } from '../cards/donut-card';
import { CompositionDataCard } from '../cards/composition-card-component';
import type { TabDef, Preset } from '../../presets/types';
import type { Segment } from '../../../../types/segment-api';

interface Props {
  tab: TabDef;
  segment: Segment;
  preset: Preset;
}

export function PresetTab({ tab, segment, preset }: Props): ReactElement {
  const cols = tab.gridCols ?? 2;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 16 }}>
      {tab.kpis.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${tab.kpis.length}, minmax(0, 1fr))`,
            gap: 12,
          }}
        >
          {tab.kpis.map((spec) => (
            <KpiCard key={spec.id} spec={spec} segment={segment} preset={preset} cacheKey={`kpi:${tab.id}:${spec.id}`} />
          ))}
        </div>
      )}

      {tab.cards.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: 12,
          }}
        >
          {tab.cards.map((card) => {
            const cacheKey = `card:${tab.id}:${card.id}`;
            switch (card.kind) {
              case 'line':         return <LineChartCard       key={card.id} spec={card} segment={segment} preset={preset} cacheKey={cacheKey} />;
              case 'bar':          return <BarListCard         key={card.id} spec={card} segment={segment} preset={preset} cacheKey={cacheKey} />;
              case 'donut':        return <DonutCard           key={card.id} spec={card} segment={segment} preset={preset} cacheKey={cacheKey} />;
              case 'composition':  return <CompositionDataCard key={card.id} spec={card} segment={segment} preset={preset} cacheKey={cacheKey} />;
              default:             return null;
            }
          })}
        </div>
      )}
    </div>
  );
}
