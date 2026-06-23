/**
 * AnnotationOverlay — resolveX position-mapping unit tests.
 *
 * resolveX is a module-private helper; we test its behaviour through the
 * AnnotationOverlay component's output (element count + x props).
 * Using @vitest-environment node because we only inspect the returned
 * React element array — no DOM rendering needed.
 *
 * Scenarios:
 *   1. Exact-match date → resolved to that category value.
 *   2. ISO datetime prefix match ("2024-04-07" hits "2024-04-07T00:00:00.000").
 *   3. Date outside the domain → nearest earlier category value used.
 *   4. Date before the entire domain → annotation omitted (null → skipped).
 *   5. Empty domain → no elements produced.
 *   6. Ranged annotation (ends_at set) → ReferenceArea element produced.
 */
// @vitest-environment node

import { describe, it, expect } from 'vitest';
import type { ChartAnnotation } from '../../../api/chart-annotations';
import { AnnotationOverlay } from '../annotation-overlay';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAnnotation(overrides: Partial<ChartAnnotation> = {}): ChartAnnotation {
  return {
    id: 1,
    game: null,
    type: 'patch',
    title: 'Test patch',
    starts_at: '2024-04-07',
    ends_at: null,
    url: null,
    created_by: null,
    created_at: Date.now(),
    ...overrides,
  };
}

/** Extract the x prop from a ReferenceLine element (point event). */
function getX(el: React.ReactElement): string | undefined {
  return (el.props as { x?: string }).x;
}

/** Extract the x1/x2 props from a ReferenceArea element (ranged event). */
function getX1X2(el: React.ReactElement): { x1?: string; x2?: string } {
  const p = el.props as { x1?: string; x2?: string };
  return { x1: p.x1, x2: p.x2 };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('annotation_overlay_exact_date_match', () => {
  it('returns a ReferenceLine with x = the exact category value', () => {
    const domain = ['2024-04-05', '2024-04-06', '2024-04-07', '2024-04-08'];
    const elements = AnnotationOverlay({
      annotations: [makeAnnotation({ starts_at: '2024-04-07' })],
      categoryDomain: domain,
    });
    expect(elements).toHaveLength(1);
    expect(getX(elements[0]!)).toBe('2024-04-07');
  });
});

describe('annotation_overlay_iso_datetime_prefix_match', () => {
  it('resolves YYYY-MM-DD annotation date against ISO datetime category strings', () => {
    const domain = [
      '2024-04-05T00:00:00.000',
      '2024-04-06T00:00:00.000',
      '2024-04-07T00:00:00.000',
    ];
    const elements = AnnotationOverlay({
      annotations: [makeAnnotation({ starts_at: '2024-04-07' })],
      categoryDomain: domain,
    });
    expect(elements).toHaveLength(1);
    expect(getX(elements[0]!)).toBe('2024-04-07T00:00:00.000');
  });
});

describe('annotation_overlay_nearest_earlier_fallback', () => {
  it('uses the nearest earlier category value when exact date is a gap', () => {
    // Domain has no 2024-04-07 entry (gap day)
    const domain = ['2024-04-05', '2024-04-06', '2024-04-08', '2024-04-09'];
    const elements = AnnotationOverlay({
      annotations: [makeAnnotation({ starts_at: '2024-04-07' })],
      categoryDomain: domain,
    });
    expect(elements).toHaveLength(1);
    // Nearest earlier = 2024-04-06
    expect(getX(elements[0]!)).toBe('2024-04-06');
  });
});

describe('annotation_overlay_date_before_domain_omitted', () => {
  it('omits annotation whose date is entirely before the domain window', () => {
    const domain = ['2024-04-05', '2024-04-06', '2024-04-07'];
    const elements = AnnotationOverlay({
      annotations: [makeAnnotation({ starts_at: '2024-03-01' })],
      categoryDomain: domain,
    });
    // '2024-03-01' < '2024-04-05' → no earlier value → resolveX returns null → skipped
    expect(elements).toHaveLength(0);
  });
});

describe('annotation_overlay_empty_domain', () => {
  it('returns an empty array when categoryDomain is empty', () => {
    const elements = AnnotationOverlay({
      annotations: [makeAnnotation()],
      categoryDomain: [],
    });
    expect(elements).toHaveLength(0);
  });
});

describe('annotation_overlay_ranged_event_reference_area', () => {
  it('produces a ReferenceArea for annotations with ends_at set', () => {
    const domain = ['2024-04-05', '2024-04-06', '2024-04-07', '2024-04-08', '2024-04-09'];
    const elements = AnnotationOverlay({
      annotations: [
        makeAnnotation({ type: 'campaign', starts_at: '2024-04-06', ends_at: '2024-04-08' }),
      ],
      categoryDomain: domain,
    });
    expect(elements).toHaveLength(1);
    const { x1, x2 } = getX1X2(elements[0]!);
    expect(x1).toBe('2024-04-06');
    expect(x2).toBe('2024-04-08');
  });

  it('clamps end to start when ends_at date is not in the domain', () => {
    const domain = ['2024-04-05', '2024-04-06', '2024-04-07'];
    // ends_at is after the domain window — no earlier value for future date
    // resolveX for '2024-04-10' → nearest earlier = '2024-04-07'
    const elements = AnnotationOverlay({
      annotations: [
        makeAnnotation({ starts_at: '2024-04-06', ends_at: '2024-04-10' }),
      ],
      categoryDomain: domain,
    });
    expect(elements).toHaveLength(1);
    const { x2 } = getX1X2(elements[0]!);
    expect(x2).toBe('2024-04-07');
  });
});

describe('annotation_overlay_multiple_annotations', () => {
  it('produces one element per annotation in the domain, skips out-of-domain', () => {
    const domain = ['2024-04-05', '2024-04-06', '2024-04-07'];
    const elements = AnnotationOverlay({
      annotations: [
        makeAnnotation({ id: 1, starts_at: '2024-04-05' }),
        makeAnnotation({ id: 2, starts_at: '2024-04-06' }),
        makeAnnotation({ id: 3, starts_at: '2024-03-01' }), // before domain
      ],
      categoryDomain: domain,
    });
    expect(elements).toHaveLength(2);
  });
});
