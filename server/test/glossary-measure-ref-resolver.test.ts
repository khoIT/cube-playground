/**
 * Unit tests for deriveMeasureRef — the glossary-to-cube-member resolver.
 * Tests the matrix: measure/ratio/expression/unknown formulas, overrides, prefix stripping.
 */

import { describe, it, expect } from 'vitest';
import { deriveMeasureRef, type DerivedRef } from '../src/routes/glossary-measure-ref-resolver.js';
import type { BusinessMetric } from '../src/types/business-metric.js';

function makeMeasureMetric(ref: string): BusinessMetric {
  return {
    id: 'test',
    label: 'Test',
    formula: { type: 'measure', ref },
  } as BusinessMetric;
}

function makeRatioMetric(numerator: string, denominator: string): BusinessMetric {
  return {
    id: 'test',
    label: 'Test',
    formula: { type: 'ratio', numerator, denominator },
  } as BusinessMetric;
}

function makeExpressionMetric(): BusinessMetric {
  return {
    id: 'test',
    label: 'Test',
    formula: { type: 'expression' },
  } as BusinessMetric;
}

describe('deriveMeasureRef', () => {
  describe('measure formula', () => {
    it('measure formula → refKind "measure", measureRef = formula.ref', () => {
      const getById = () => makeMeasureMetric('recharge.revenue_vnd');
      const result = deriveMeasureRef('business_metrics/revenue', null, getById);
      expect(result).toEqual({
        measureRef: 'recharge.revenue_vnd',
        ratioRef: null,
        refKind: 'measure',
      });
    });
  });

  describe('ratio formula', () => {
    it('ratio formula → refKind "ratio", ratioRef set, measureRef null', () => {
      const getById = () => makeRatioMetric('retention.retained_d7', 'retention.cohort_size');
      const result = deriveMeasureRef('business_metrics/d7_retention', null, getById);
      expect(result).toEqual({
        measureRef: null,
        ratioRef: { numerator: 'retention.retained_d7', denominator: 'retention.cohort_size' },
        refKind: 'ratio',
      });
    });
  });

  describe('expression formula', () => {
    it('expression formula → refKind "expression", both refs null', () => {
      const getById = () => makeExpressionMetric();
      const result = deriveMeasureRef('business_metrics/stickiness', null, getById);
      expect(result).toEqual({
        measureRef: null,
        ratioRef: null,
        refKind: 'expression',
      });
    });
  });

  describe('missing catalog', () => {
    it('getById returns undefined → refKind "unknown"', () => {
      const getById = () => undefined;
      const result = deriveMeasureRef('business_metrics/missing', null, getById);
      expect(result).toEqual({
        measureRef: null,
        ratioRef: null,
        refKind: 'unknown',
      });
    });

    it('no getById provided → refKind "unknown"', () => {
      const result = deriveMeasureRef('business_metrics/revenue', null, undefined);
      expect(result).toEqual({
        measureRef: null,
        ratioRef: null,
        refKind: 'unknown',
      });
    });
  });

  describe('default_measure_ref override', () => {
    it('defaultMeasureRef beats formula → refKind "measure", measureRef = override', () => {
      const getById = () => makeRatioMetric('a', 'b'); // ratio formula, should be ignored
      const result = deriveMeasureRef('business_metrics/d7_retention', 'active_daily.dau', getById);
      expect(result).toEqual({
        measureRef: 'active_daily.dau',
        ratioRef: null,
        refKind: 'measure',
      });
    });
  });

  describe('prefix stripping', () => {
    it('primaryCatalogId with dir/ → toCatalogId strips and looks up bare id', () => {
      const getById = (id: string) => {
        // Only 'revenue' (bare) should be looked up, not 'business_metrics/revenue'
        return id === 'revenue' ? makeMeasureMetric('recharge.revenue_vnd') : undefined;
      };
      const result = deriveMeasureRef('business_metrics/revenue', null, getById);
      expect(result.measureRef).toBe('recharge.revenue_vnd');
    });

    it('primaryCatalogId already bare → passes through unchanged', () => {
      const getById = (id: string) => {
        return id === 'revenue' ? makeMeasureMetric('recharge.revenue_vnd') : undefined;
      };
      const result = deriveMeasureRef('revenue', null, getById);
      expect(result.measureRef).toBe('recharge.revenue_vnd');
    });
  });

  describe('null primaryCatalogId', () => {
    it('null primaryCatalogId + no override → refKind "unknown"', () => {
      const result = deriveMeasureRef(null, null, undefined);
      expect(result).toEqual({
        measureRef: null,
        ratioRef: null,
        refKind: 'unknown',
      });
    });

    it('null primaryCatalogId + override → refKind "measure" with override', () => {
      const result = deriveMeasureRef(null, 'active_daily.dau', undefined);
      expect(result).toEqual({
        measureRef: 'active_daily.dau',
        ratioRef: null,
        refKind: 'measure',
      });
    });
  });
});
