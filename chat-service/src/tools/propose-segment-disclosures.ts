/**
 * Disclosure copy for the propose_segment tool.
 *
 * Builds human-readable explanation strings (EN + optional VN) for each
 * segment kind. These strings are surfaced in the segment_proposal SSE payload
 * so the frontend can show the user what the segment means before they confirm.
 *
 * Kept separate from the handler logic so the copy can be updated without
 * touching validation/resolution code.
 */

import type { SegmentableMeasure } from './get-segmentable-measures.js';

// ---------------------------------------------------------------------------
// Disclosure param types
// ---------------------------------------------------------------------------

export type DisclosureParams =
  | {
      kind: 'threshold';
      label: string;
      value: number;
      currency?: string;
      window?: string;
      isVi: boolean;
    }
  | {
      kind: 'percentile';
      label: string;
      topPct: number;
      p: number;
      cutoff: number;
      currency?: string;
      window?: string;
      populationLabel: string;
      isVi: boolean;
    }
  | {
      kind: 'top_n';
      label: string;
      topN: number;
      p: number;
      cutoff: number;
      currency?: string;
      window?: string;
      populationLabel: string;
      populationCount: number;
      isVi: boolean;
    };

// ---------------------------------------------------------------------------
// Disclosure builder for threshold / percentile / top_n kinds
// ---------------------------------------------------------------------------

export function buildDisclosures(params: DisclosureParams): string[] {
  const lines: string[] = [];
  const { isVi } = params;

  if (params.kind === 'threshold') {
    const win = params.window ?? 'lifetime';
    const cur = params.currency ? ` ${params.currency}` : '';
    lines.push(`Segment: ${params.label} ≥ ${params.value}${cur} (${win} window).`);
    if (isVi) {
      lines.push(`Phân khúc: ${params.label} ≥ ${params.value}${cur} (cửa sổ ${win}).`);
    }
    lines.push(
      'This is a fixed threshold — the count updates each time the segment is refreshed ' +
        'as users cross or drop below the threshold.',
    );
    if (isVi) {
      lines.push('Ngưỡng cố định — số lượng cập nhật mỗi lần làm mới phân khúc.');
    }
  }

  if (params.kind === 'percentile') {
    const cur = params.currency ? ` ${params.currency}` : '';
    const win = params.window ? ` (${params.window})` : '';
    const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    lines.push(
      `Top ${params.topPct}% of ${params.populationLabel} by ${params.label}${win}.`,
    );
    lines.push(
      `Resolved cutoff: ≥ ${fmt(params.cutoff)}${cur} at the ${params.p.toFixed(1)}th percentile.`,
    );
    lines.push(
      'Rolling percentile: the cutoff is re-resolved each time the segment refreshes, ' +
        'so membership changes as the population distribution shifts.',
    );
    if (isVi) {
      lines.push(`Top ${params.topPct}% ${params.populationLabel} theo ${params.label}${win}.`);
      lines.push(`Ngưỡng giải quyết: ≥ ${fmt(params.cutoff)}${cur} ở phân vị thứ ${params.p.toFixed(1)}.`);
      lines.push(
        'Phân vị động: ngưỡng được tính lại mỗi lần làm mới, thành viên thay đổi theo phân phối dân số.',
      );
    }
  }

  if (params.kind === 'top_n') {
    const cur = params.currency ? ` ${params.currency}` : '';
    const win = params.window ? ` (${params.window})` : '';
    const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    const pctDisplay = (100 - params.p).toFixed(1);
    lines.push(
      `Requested top ${fmt(params.topN)} out of ${fmt(params.populationCount)} ${params.populationLabel}.`,
    );
    lines.push(
      `Converted to top ≈${pctDisplay}% by ${params.label}${win} (percentile ≥${params.p.toFixed(1)}).`,
    );
    lines.push(`Resolved cutoff: ≥ ${fmt(params.cutoff)}${cur}.`);
    lines.push(
      'Rolling approximation: stored as a percentile, so the count drifts as the population changes. ' +
        'The absolute count may not equal exactly ' + fmt(params.topN) + ' after each refresh.',
    );
    if (isVi) {
      lines.push(
        `Yêu cầu top ${fmt(params.topN)} trong ${fmt(params.populationCount)} ${params.populationLabel}.`,
      );
      lines.push(
        `Chuyển thành top ≈${pctDisplay}% theo ${params.label}${win} (phân vị ≥${params.p.toFixed(1)}).`,
      );
      lines.push(
        'Xấp xỉ động: lưu dưới dạng phân vị, số lượng thực tế có thể thay đổi sau mỗi lần làm mới.',
      );
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Disclosure builder for the query kind (plain dimension predicate segment)
// ---------------------------------------------------------------------------

export function buildQueryDisclosures(params: {
  name: string;
  cube: string;
  isVi: boolean;
}): string[] {
  const lines: string[] = [
    `Segment "${params.name}" will match users on cube ${params.cube} using the exact dimension filters from your explored query.`,
    'This is a rolling predicate segment — membership is re-evaluated each time the segment refreshes as dimension values change.',
    'Estimated count is not pre-computed. Confirm to save the segment and trigger a refresh.',
  ];
  if (params.isVi) {
    lines.push(
      `Phân khúc "${params.name}" sẽ lọc người dùng trên cube ${params.cube} theo các điều kiện lọc đã khám phá.`,
      'Đây là phân khúc điều kiện động — thành viên được đánh giá lại mỗi lần làm mới phân khúc.',
      'Số lượng ước tính chưa được tính. Nhấn Xác nhận để lưu và làm mới.',
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Helper: human-readable population label for a measure
// ---------------------------------------------------------------------------

export function populationLabelFor(measure: SegmentableMeasure): string {
  // Derive a readable population label from the measure concept.
  // Catalog entries for spend-like measures typically describe payers or active users.
  // Use the concept as the fallback.
  return measure.label ? `${measure.label} population` : measure.concept;
}
