/**
 * Derive a CDP metric_name from a segment name. Format: `segment_<slug>_member`
 * where slug is lowercase a-z0-9_, ≤ 64 chars total.
 */

export function deriveMetricName(segmentName: string): string {
  const slug = segmentName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  const safe = slug.length > 0 ? slug : 'segment';
  return `segment_${safe}_member`.slice(0, 64);
}
