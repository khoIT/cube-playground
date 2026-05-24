/**
 * metric-override-store — session-scoped override for broken business metrics.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useMetricOverrideStore } from '../metric-override-store';

beforeEach(() => {
  useMetricOverrideStore.getState().reset();
});

describe('useMetricOverrideStore', () => {
  it('starts with an empty allow set', () => {
    expect(useMetricOverrideStore.getState().allowed.size).toBe(0);
    expect(useMetricOverrideStore.getState().isAllowed('npu')).toBe(false);
  });

  it('allow() marks a metric as overridden', () => {
    useMetricOverrideStore.getState().allow('npu');
    expect(useMetricOverrideStore.getState().isAllowed('npu')).toBe(true);
  });

  it('allow() is idempotent — same id twice yields the same state', () => {
    useMetricOverrideStore.getState().allow('npu');
    const first = useMetricOverrideStore.getState().allowed;
    useMetricOverrideStore.getState().allow('npu');
    const second = useMetricOverrideStore.getState().allowed;
    expect(second).toBe(first);
  });

  it('reset() clears all overrides', () => {
    useMetricOverrideStore.getState().allow('a');
    useMetricOverrideStore.getState().allow('b');
    useMetricOverrideStore.getState().reset();
    expect(useMetricOverrideStore.getState().allowed.size).toBe(0);
  });
});
