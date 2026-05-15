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
