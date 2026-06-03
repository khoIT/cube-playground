/**
 * build-layout tests — deterministic column geometry, layer filtering (visible
 * columns close the gap), per-layer cap + hiddenCount (V2), and focus/dim flags.
 */

import { describe, expect, it } from 'vitest';

import {
  buildLayout,
  COLUMN_WIDTH,
  ROW_PITCH,
  DEFAULT_LAYER_CAP,
} from '../build-layout';
import type { ConceptNode, ConceptLayer } from '../concept-node';
import type { LayerFilter } from '../../schema-cartographer/layer-filter-pills';

const ALL: ReadonlySet<LayerFilter> = new Set<LayerFilter>([
  'fields',
  'metrics',
  'glossary',
  'segments',
]);

const node = (kind: ConceptLayer, ref: string): ConceptNode => ({ kind, ref, label: ref });

describe('buildLayout', () => {
  it('places layers in deterministic columns and rows', () => {
    const { nodes } = buildLayout(
      [node('field', 'data_model/a'), node('field', 'data_model/b'), node('metric', 'business_metrics/m')],
      { activeLayers: ALL },
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get('data_model/a')!.position).toEqual({ x: 0, y: 0 });
    expect(byId.get('data_model/b')!.position).toEqual({ x: 0, y: ROW_PITCH });
    // metric is the 2nd visible column.
    expect(byId.get('business_metrics/m')!.position).toEqual({ x: COLUMN_WIDTH, y: 0 });
    // type carries the layer kind for reactflow nodeTypes dispatch.
    expect(byId.get('business_metrics/m')!.type).toBe('metric');
  });

  it('hides filtered-off layers and closes the column gap', () => {
    const { nodes } = buildLayout(
      [node('field', 'data_model/a'), node('metric', 'business_metrics/m'), node('term', 'glossary/t')],
      { activeLayers: new Set<LayerFilter>(['metrics', 'glossary']) },
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.has('data_model/a')).toBe(false); // fields hidden
    // metric becomes the first visible column (x=0), term the second.
    expect(byId.get('business_metrics/m')!.position.x).toBe(0);
    expect(byId.get('glossary/t')!.position.x).toBe(COLUMN_WIDTH);
  });

  it('caps a layer and reports hiddenCount; expanding lifts the cap', () => {
    const many: ConceptNode[] = Array.from({ length: DEFAULT_LAYER_CAP + 5 }, (_, i) =>
      node('field', `data_model/f${i}`),
    );
    const capped = buildLayout(many, { activeLayers: ALL });
    expect(capped.nodes).toHaveLength(DEFAULT_LAYER_CAP);
    expect(capped.hiddenCounts.field).toBe(5);

    const expanded = buildLayout(many, {
      activeLayers: ALL,
      expandedLayers: new Set<ConceptLayer>(['field']),
    });
    expect(expanded.nodes).toHaveLength(DEFAULT_LAYER_CAP + 5);
    expect(expanded.hiddenCounts.field).toBe(0);
  });

  it('flags the focused node and dims unconnected nodes', () => {
    const { nodes } = buildLayout(
      [
        node('field', 'data_model/a'),
        node('metric', 'business_metrics/m'),
        node('term', 'glossary/t'),
      ],
      {
        activeLayers: ALL,
        focusedRef: 'data_model/a',
        edgeTargets: new Set(['business_metrics/m']),
      },
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get('data_model/a')!.data).toMatchObject({ focused: true, dimmed: false });
    expect(byId.get('business_metrics/m')!.data).toMatchObject({ focused: false, dimmed: false });
    expect(byId.get('glossary/t')!.data).toMatchObject({ focused: false, dimmed: true });
  });

  it('dims nothing when there is no focus', () => {
    const { nodes } = buildLayout([node('field', 'data_model/a')], { activeLayers: ALL });
    expect(nodes[0].data.dimmed).toBe(false);
    expect(nodes[0].data.focused).toBe(false);
  });
});
