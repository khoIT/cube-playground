import { describe, expect, it } from 'vitest';

import { pushFromMetric } from './push-from-metric';
import type { BusinessMetric } from '../../pages/Catalog/metrics-tab/business-metric-types';

const METRIC: BusinessMetric = {
  id: 'paying_users',
  label: 'Paying users',
  description: 'PU',
  tier: 1,
  domain: 'payments',
  owner: 'data@vng',
  trust: 'certified',
  formula: { type: 'measure', ref: 'recharge.paying_users' },
};

describe('pushFromMetric', () => {
  it('builds a handoff URL with metric id + inferred segment name', () => {
    const { url, inferredSegmentName } = pushFromMetric(METRIC);
    expect(inferredSegmentName).toBe('paying_users-activation');
    expect(url).toBe(
      '/segments/new?from-metric=paying_users&segment-name=paying_users-activation',
    );
  });
});
