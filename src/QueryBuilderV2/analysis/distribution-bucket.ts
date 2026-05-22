export interface Bin {
  bucket: string;
  start: number;
  end: number;
  count: number;
}

export interface Summary {
  min: number;
  max: number;
  mean: number;
  median: number;
  total: number;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function bucket(values: number[], binCount: number): Bin[] {
  const cleaned = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  if (cleaned.length === 0) {
    return [];
  }

  const min = Math.min(...cleaned);
  const max = Math.max(...cleaned);

  if (min === max) {
    return [
      {
        bucket: formatNumber(min),
        start: min,
        end: min,
        count: cleaned.length,
      },
    ];
  }

  const safeBinCount = Math.max(1, Math.floor(binCount));
  const binWidth = (max - min) / safeBinCount;
  const bins: Bin[] = [];

  for (let i = 0; i < safeBinCount; i += 1) {
    const start = min + binWidth * i;
    const end = i === safeBinCount - 1 ? max : min + binWidth * (i + 1);

    bins.push({
      bucket: `${formatNumber(start)} – ${formatNumber(end)}`,
      start,
      end,
      count: 0,
    });
  }

  for (const value of cleaned) {
    let index = Math.floor((value - min) / binWidth);

    if (index >= safeBinCount) {
      index = safeBinCount - 1;
    }
    if (index < 0) {
      index = 0;
    }

    bins[index].count += 1;
  }

  return bins;
}

/**
 * Bucket rows into N bins while preserving a per-group split. Returns recharts-
 * friendly rows shaped `{ bucket, start, end, [groupValueA]: count, [groupValueB]: count, ... }`
 * so a stacked BarChart can render one Bar per group with `stackId="1"`.
 */
export interface GroupedBin extends Bin {
  /** Per-group counts keyed by the group dimension value (stringified). */
  [groupKey: string]: number | string;
}

export interface GroupedBucketResult {
  bins: GroupedBin[];
  /** Sorted list of distinct group values (largest total first), capped to `groupLimit`. */
  groups: string[];
}

export function bucketByGroup(
  rows: ReadonlyArray<Record<string, unknown>>,
  valueKey: string,
  groupKey: string,
  binCount: number,
  groupLimit = 8
): GroupedBucketResult {
  const pairs: { value: number; group: string }[] = [];
  for (const row of rows) {
    const raw = row?.[valueKey];
    const v = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(v)) continue;
    const g = row?.[groupKey];
    const gs = g == null || g === '' ? '∅' : String(g);
    pairs.push({ value: v, group: gs });
  }

  if (pairs.length === 0) {
    return { bins: [], groups: [] };
  }

  // Cap group cardinality: keep top-N by row count, bucket the tail as "Other".
  const totalsByGroup = new Map<string, number>();
  for (const { group } of pairs) {
    totalsByGroup.set(group, (totalsByGroup.get(group) ?? 0) + 1);
  }
  const ranked = [...totalsByGroup.entries()].sort((a, b) => b[1] - a[1]);
  const topGroups = ranked.slice(0, groupLimit).map(([g]) => g);
  const groupSet = new Set(topGroups);
  const hasOther = ranked.length > groupLimit;
  const groups = hasOther ? [...topGroups, 'Other'] : topGroups;

  // Build flat value list to reuse the existing bin computation.
  const flat = pairs.map((p) => p.value);
  const baseBins = bucket(flat, binCount);

  // Zero-init per-group counts on each bin.
  const grouped: GroupedBin[] = baseBins.map((b) => {
    const row: GroupedBin = { ...b, count: 0 };
    for (const g of groups) row[g] = 0;
    return row;
  });
  if (grouped.length === 0) return { bins: [], groups };

  // Re-bucket pair-by-pair so each row lands in (bin, group).
  const min = baseBins[0].start;
  const max = baseBins[baseBins.length - 1].end;
  const binWidth = (max - min) / baseBins.length;
  for (const { value, group } of pairs) {
    let idx = binWidth === 0 ? 0 : Math.floor((value - min) / binWidth);
    if (idx >= baseBins.length) idx = baseBins.length - 1;
    if (idx < 0) idx = 0;
    const gkey = groupSet.has(group) ? group : 'Other';
    const current = grouped[idx][gkey];
    grouped[idx][gkey] = (typeof current === 'number' ? current : 0) + 1;
    grouped[idx].count += 1;
  }

  return { bins: grouped, groups };
}

export function summarise(values: number[]): Summary | null {
  const cleaned = values
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .slice()
    .sort((a, b) => a - b);

  if (cleaned.length === 0) {
    return null;
  }

  const total = cleaned.length;
  const min = cleaned[0];
  const max = cleaned[total - 1];
  const sum = cleaned.reduce((acc, v) => acc + v, 0);
  const mean = sum / total;

  let median: number;

  if (total % 2 === 1) {
    median = cleaned[(total - 1) / 2];
  } else {
    median = (cleaned[total / 2 - 1] + cleaned[total / 2]) / 2;
  }

  return { min, max, mean, median, total };
}
