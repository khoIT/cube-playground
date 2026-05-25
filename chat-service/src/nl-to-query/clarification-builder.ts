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
  } else if (slots.intent?.value === 'leaderboard') {
    // Leaderboard intent NEEDS an entity dimension — surface a forced clarification.
    out.push({ slot: 'dimension', confidence: 0 });
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

// Hand-curated within-category ordering. Surfaces the fundamental metrics
// (Revenue, ARPU, DAU, retention) ahead of derivative ones (ARPPU, NPU…) so
// a 4–6 chip cap doesn't drop them. Unknown ids fall back to label order.
const TERM_PRIORITY_AGGREGATE = [
  'revenue', 'arpu', 'arpdau', 'arppu', 'ltv',
  'dau', 'mau', 'wau', 'first_purchase_rate', 'payer_conversion_rate',
  'd1_retention', 'd7_retention', 'd30_retention',
];
const TERM_PRIORITY_LEADERBOARD = [
  // For "top X" questions raw per-user amounts beat aggregates.
  'revenue', 'ltv', 'first_purchase_rate', 'arpu', 'arpdau', 'arppu',
];

const METRIC_OPTION_COUNT = 5;

function metricOptions(
  glossary: OfficialTerm[],
  intent: 'leaderboard' | 'aggregate' | 'trend' | 'comparison',
): ClarificationOption[] {
  const categories = ['revenue', 'monetisation', 'engagement', 'retention'];
  const inCategory = (t: OfficialTerm) =>
    categories.includes((t.category ?? '').toLowerCase());
  const candidates = glossary.filter(inCategory);

  const priority = intent === 'leaderboard' ? TERM_PRIORITY_LEADERBOARD : TERM_PRIORITY_AGGREGATE;
  const rank = (id: string): number => {
    const idx = priority.indexOf(id);
    return idx >= 0 ? idx : priority.length + 1;
  };
  candidates.sort((a, b) => {
    const ra = rank(a.id);
    const rb = rank(b.id);
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label);
  });

  return candidates.slice(0, METRIC_OPTION_COUNT).map((t) => ({
    value: t.primaryCatalogId ?? t.id,
    label_en: t.label,
    label_vi: t.labelVi ?? t.label,
  }));
}

function dimensionQuestion(slots: DisambiguationSlots): { en: string; vi: string } {
  if (slots.intent?.value === 'leaderboard') {
    return {
      en: 'Rank by which entity (e.g. by user, by country, by channel)?',
      vi: 'Xếp hạng theo đối tượng nào (vd. theo user, theo quốc gia, theo kênh)?',
    };
  }
  return {
    en: 'How should I group the results?',
    vi: 'Nhóm kết quả theo gì?',
  };
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
  const q = target.slot === 'dimension' ? dimensionQuestion(input.slots) : QUESTIONS[target.slot];
  const intent = input.slots.intent?.value ?? 'aggregate';
  const options = target.slot === 'metric' ? metricOptions(input.glossary, intent) : undefined;

  return [
    {
      slot: target.slot,
      question_en: q.en,
      question_vi: q.vi,
      options,
    },
  ];
}
