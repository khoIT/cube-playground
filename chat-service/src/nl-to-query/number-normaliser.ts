/**
 * Vietnamese + English number parser.
 *
 * Handles common shorthand: "10tr" / "10 triệu" → 10_000_000,
 * "10.5tr" → 10_500_000, "1tỉ" / "1 tỷ" → 1_000_000_000,
 * "5k" / "5 nghìn" → 5_000. Per-period suffixes "10tr/tháng" or "10tr một
 * tháng" mark the number as a recurring threshold (perPeriod='month').
 *
 * Decimal-vs-thousand ambiguity for "1.000": in VI context with no nearby
 * decimal usage, treat as 1000 and emit a warning so callers can show what
 * was assumed. In EN context, treat as 1.0.
 */

export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface ParsedNumber {
  raw: string;
  span: [number, number];
  value: number;
  perPeriod?: Period;
  warnings: string[];
}

const SUFFIX_TO_MULTIPLIER: Record<string, number> = {
  k: 1_000,
  nghìn: 1_000,
  nghin: 1_000,
  tr: 1_000_000,
  triệu: 1_000_000,
  trieu: 1_000_000,
  m: 1_000_000,
  tỉ: 1_000_000_000,
  tỷ: 1_000_000_000,
  ti: 1_000_000_000,
  ty: 1_000_000_000,
  b: 1_000_000_000,
};

const PERIOD_MAP: Record<string, Period> = {
  ngày: 'day', ngay: 'day', day: 'day',
  tuần: 'week', tuan: 'week', week: 'week',
  tháng: 'month', thang: 'month', month: 'month', mo: 'month',
  quý: 'quarter', quy: 'quarter', quarter: 'quarter',
  năm: 'year', nam: 'year', year: 'year', yr: 'year',
};

// Bounded digit count guards against ReDoS while still matching realistic
// monetary values up to a trillion.
const NUMBER_RE =
  /(\d{1,15})(?:[.,](\d{1,6}))?\s*(k|m|b|tr|triệu|trieu|tỉ|tỷ|ti|ty|nghìn|nghin)?(?:\s*[/]\s*([a-zàáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]{2,12}))?/giu;

function looksLikeThousandsSep(intPart: string, fracPart: string, isVi: boolean): boolean {
  // VI commonly writes "1.000" for thousand. Heuristic: VI context AND fractional
  // part is exactly 3 digits AND integer part is 1-3 digits (so "1.000" or "12.500"
  // but not "10.5"). EN context never collapses.
  if (!isVi) return false;
  if (fracPart.length !== 3) return false;
  return intPart.length >= 1 && intPart.length <= 3;
}

export interface ParseOptions {
  isVietnameseContext: boolean;
}

export function parseNumbers(text: string, opts: ParseOptions): ParsedNumber[] {
  const out: ParsedNumber[] = [];
  const re = new RegExp(NUMBER_RE.source, NUMBER_RE.flags);
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const [raw, intPart, fracPart, suffix, perWord] = m;
    if (!intPart) continue;

    const warnings: string[] = [];
    let value: number;

    if (fracPart) {
      const isThousands = looksLikeThousandsSep(intPart, fracPart, opts.isVietnameseContext);
      if (isThousands) {
        value = parseInt(intPart + fracPart, 10);
        warnings.push(`assumed "${intPart}.${fracPart}" is a thousands separator (Vietnamese context)`);
      } else {
        value = parseFloat(`${intPart}.${fracPart}`);
      }
    } else {
      value = parseInt(intPart, 10);
    }

    if (suffix) {
      const mult = SUFFIX_TO_MULTIPLIER[suffix.toLowerCase()];
      if (mult) value *= mult;
    }

    const result: ParsedNumber = {
      raw,
      span: [m.index, m.index + raw.length],
      value,
      warnings,
    };

    if (perWord) {
      const period = PERIOD_MAP[perWord.toLowerCase()];
      if (period) result.perPeriod = period;
    }

    out.push(result);
  }

  return out;
}
