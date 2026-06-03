/**
 * concept-node helper tests — ref builders, parsing (first-slash rule),
 * namespace→layer mapping, and the detail-route resolver used for cross-layer
 * navigation. These guard that node refs match the server relation grammar.
 */

import { describe, expect, it } from 'vitest';

import {
  makeFieldRef,
  makeMetricRef,
  makeTermRef,
  makeSegmentRef,
  parseConceptRef,
  layerForNamespace,
  conceptDetailRoute,
  type ConceptNode,
} from '../concept-node';

describe('ref builders', () => {
  it('build namespaced refs matching the server grammar', () => {
    expect(makeFieldRef('mf_users.dau')).toBe('data_model/mf_users.dau');
    expect(makeMetricRef('dau')).toBe('business_metrics/dau');
    expect(makeTermRef('whale')).toBe('glossary/whale');
    expect(makeSegmentRef('s1')).toBe('segments/s1');
  });
});

describe('parseConceptRef', () => {
  it('splits on the first slash; id may contain dots', () => {
    expect(parseConceptRef('data_model/mf_users.dau')).toEqual({
      namespace: 'data_model',
      id: 'mf_users.dau',
    });
  });

  it('returns null for a bare ref with no slash', () => {
    expect(parseConceptRef('mf_users.dau')).toBeNull();
  });
});

describe('layerForNamespace', () => {
  it('maps each namespace to its layer', () => {
    expect(layerForNamespace('data_model')).toBe('field');
    expect(layerForNamespace('business_metrics')).toBe('metric');
    expect(layerForNamespace('glossary')).toBe('term');
    expect(layerForNamespace('segments')).toBe('appSegment');
    expect(layerForNamespace('bogus')).toBeNull();
  });
});

describe('conceptDetailRoute', () => {
  const node = (kind: ConceptNode['kind'], ref: string): ConceptNode => ({ kind, ref, label: ref });

  it('reuses the relations-panel detail targets for metric/term/segment', () => {
    expect(conceptDetailRoute(node('metric', 'business_metrics/dau'))).toBe('/catalog/metric/dau');
    expect(conceptDetailRoute(node('term', 'glossary/whale'))).toBe('/catalog/glossary#whale');
    expect(conceptDetailRoute(node('appSegment', 'segments/s1'))).toBe('/segments/s1');
  });

  it('returns null for fields (no standalone detail route)', () => {
    expect(conceptDetailRoute(node('field', 'data_model/mf_users.dau'))).toBeNull();
  });
});
