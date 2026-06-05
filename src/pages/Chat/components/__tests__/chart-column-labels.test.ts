import { describe, it, expect } from 'vitest';
import { buildLabelMap, labelOf } from '../chart-column-labels';
import type { ChartColumn } from '../../../../api/chat-sse-client';

const COLUMNS: ChartColumn[] = [
  { key: 'mf_users.ltv_total_vnd', label: 'Total LTV (VND)', dataType: 'number', kind: 'measure' },
  { key: 'mf_users.days_since_last_active', label: 'Days since last active', dataType: 'number', kind: 'dimension' },
];

describe('chart-column-labels', () => {
  it('buildLabelMap maps member key → label', () => {
    const m = buildLabelMap(COLUMNS);
    expect(m['mf_users.ltv_total_vnd']).toBe('Total LTV (VND)');
    expect(m['mf_users.days_since_last_active']).toBe('Days since last active');
  });

  it('buildLabelMap tolerates undefined columns', () => {
    expect(buildLabelMap(undefined)).toEqual({});
  });

  it('labelOf returns the mapped label when present', () => {
    const m = buildLabelMap(COLUMNS);
    expect(labelOf(m, 'mf_users.ltv_total_vnd')).toBe('Total LTV (VND)');
  });

  it('labelOf humanises the member leaf as a fallback', () => {
    expect(labelOf({}, 'mf_users.ltv_total_vnd')).toBe('Ltv total vnd');
    expect(labelOf({}, 'revenue')).toBe('Revenue');
  });
});
