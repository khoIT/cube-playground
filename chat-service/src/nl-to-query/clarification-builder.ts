/**
 * Picks at most one clarification — the lowest-confidence slot below the
 * threshold — and renders bilingual question text so the LLM can paste
 * either language directly into the user-facing reply.
 *
 * Options are sourced from the glossary metric catalogue: when we know the
 * user meant SOME metric but not WHICH, we surface the top metric labels
 * with their Vietnamese counterpart so the user can recognise either.
 */

import type {
  Clarification,
  ClarificationOption,
  DisambiguationSlots,
  OfficialTerm,
} from './types.js';

export interface ClarifyInput {
  slots: DisambiguationSlots;
  glossary: OfficialTerm[];
  threshold: number;
}

interface SlotInfo {
  slot: Clarification['slot'];
  confidence: number;
}

function listSlots(slots: DisambiguationSlots): SlotInfo[] {
  const out: SlotInfo[] = [];
  out.push({ slot: 'metric', confidence: slots.metric.confidence });
  if (slots.dimension?.value || slots.dimension?.alias) {
    out.push({ slot: 'dimension', confidence: slots.dimension.confidence });
  }
  // Treat timeRange as always-required when a metric is set — the user
  // almost certainly cares which window the metric covers, so prompt when
  // the engine could not pin one down.
  if (slots.timeRange?.value) {
    out.push({ slot: 'timeRange', confidence: slots.timeRange.confidence });
  } else if (slots.metric.value || slots.metric.alias) {
    out.push({ slot: 'timeRange', confidence: 0 });
  }
  if (slots.filters?.length) {
    const minFilter = slots.filters.reduce((a, b) => (a.confidence < b.confidence ? a : b));
    out.push({ slot: 'filters', confidence: minFilter.confidence });
  }
  return out;
}

function metricOptions(glossary: OfficialTerm[]): ClarificationOption[] {
  // Top metrics by category — keeps the list short and avoids overwhelming
  // the user. We pick the first 4 metric-classed terms ordered by category
  // priority (revenue → engagement → retention → fallback).
  const priority = ['revenue', 'monetisation', 'engagement', 'retention'];
  const byCategory = new Map<string, OfficialTerm[]>();
  for (const t of glossary) {
    const cat = (t.category ?? 'other').toLowerCase();
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(t);
  }
  const ordered: OfficialTerm[] = [];
  for (const cat of priority) {
    for (const t of byCategory.get(cat) ?? []) ordered.push(t);
  }
  return ordered.slice(0, 4).map((t) => ({
    value: t.primaryCatalogId ?? t.id,
    label_en: t.label,
    label_vi: t.labelVi ?? t.label,
  }));
}

const QUESTIONS: Record<Clarification['slot'], { en: string; vi: string }> = {
  metric: {
    en: 'Which metric should I show?',
    vi: 'Bạn muốn xem chỉ số nào?',
  },
  dimension: {
    en: 'How should I group the results?',
    vi: 'Nhóm kết quả theo gì?',
  },
  timeRange: {
    en: 'Which time range should I use?',
    vi: 'Khoảng thời gian nào?',
  },
  filters: {
    en: 'Should I apply this as a per-user filter or an overall threshold?',
    vi: 'Áp dụng làm bộ lọc từng người dùng hay ngưỡng tổng?',
  },
  comparison: {
    en: 'What two things should I compare?',
    vi: 'So sánh giữa hai đối tượng nào?',
  },
};

export function buildClarifications(input: ClarifyInput): Clarification[] {
  const slots = listSlots(input.slots);
  const weak = slots.filter((s) => s.confidence < input.threshold);
  if (weak.length === 0) return [];

  weak.sort((a, b) => a.confidence - b.confidence);
  const target = weak[0];
  const q = QUESTIONS[target.slot];
  const options = target.slot === 'metric' ? metricOptions(input.glossary) : undefined;

  return [
    {
      slot: target.slot,
      question_en: q.en,
      question_vi: q.vi,
      options,
    },
  ];
}
