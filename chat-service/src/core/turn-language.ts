/**
 * Per-turn language resolution for the reply-language guardrail.
 *
 * The chat UI serves Vietnamese and English analysts; the assistant must
 * answer in the language the user wrote in and never mix the two in one
 * reply. Detection is a cheap server-side heuristic (no LLM call):
 *
 *   1. Vietnamese-specific diacritics anywhere → 'vi'.
 *   2. Otherwise ≥2 hits in a small list of common diacritic-free
 *      Vietnamese words ("cho xem doanh thu") → 'vi'.
 *   3. Otherwise ≥2 ASCII alphabetic words → 'en'.
 *   4. Otherwise null (emoji-only, member-names-only, numbers).
 *
 * Ambiguous turns fall back to the most recent prior user turn with a
 * detectable language; a fully ambiguous session defaults to English
 * (cube members / metrics are English, so it is the safer guess).
 */

/** Characters that only occur in Vietnamese orthography (incl. đ/Đ and tonal vowels). */
const VI_DIACRITIC_RE =
  /[ăâđêôơưĂÂĐÊÔƠƯáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵÁÀẢÃẠẮẰẲẴẶẤẦẨẪẬÉÈẺẼẸẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌỐỒỔỖỘỚỜỞỠỢÚÙỦŨỤỨỪỬỮỰÝỲỶỸỴ]/;

/**
 * Common Vietnamese words analysts type without diacritics. Deliberately
 * short and high-frequency — two independent hits are required, so a stray
 * English collision ("cho" never appears in English analytics prose) cannot
 * flip a genuinely English message.
 */
const VI_BARE_WORDS = new Set([
  'cho', 'xem', 'bao', 'nhieu', 'doanh', 'thu', 'nguoi', 'choi', 'ngay',
  'thang', 'tuan', 'cua', 'la', 'khong', 'giup', 'voi', 'theo', 'trong',
  // NOTE: no English-collision words here ('so', 'do', 'than' are excluded
  // on purpose — they appear in normal English analytics prose).
  'nap', 'tien', 'moi', 'hom', 'qua', 'nay', 'tai', 'khoan', 'luong',
]);

export type TurnLanguage = 'vi' | 'en';

/**
 * Strip locked tokens and code spans before detection so English-only
 * identifiers ({{field:recharge.revenue_vnd}}, `mf_users.ltv_vnd`, SQL)
 * never skew a Vietnamese message toward 'en'.
 */
function stripIdentifierNoise(text: string): string {
  return text
    .replace(/\{\{[^}]*\}\}/g, ' ') // {{field:...}} / {{cite:...}} tokens
    .replace(/`[^`]*`/g, ' '); // inline code spans
}

/** Detect the language of a single message; null when there is no clear signal. */
export function detectMessageLanguage(text: string): TurnLanguage | null {
  const cleaned = stripIdentifierNoise(text);
  if (VI_DIACRITIC_RE.test(cleaned)) return 'vi';

  const words = cleaned.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  // Distinct hits — a repeated word ("la la") must not count twice.
  const viHits = new Set(words.filter((w) => VI_BARE_WORDS.has(w))).size;
  if (viHits >= 2) return 'vi';

  // ≥2 plain ASCII words and no Vietnamese signal → English prose.
  if (words.length >= 2) return 'en';

  return null;
}

/**
 * Resolve the language the assistant must reply in for this turn.
 * `priorUserTexts` is the session's earlier user messages in chronological
 * order; the most recent detectable one wins when the current turn is
 * ambiguous. Defaults to English on a fully ambiguous session.
 */
export function resolveTurnLanguage(
  message: string,
  priorUserTexts: readonly string[],
): TurnLanguage {
  const current = detectMessageLanguage(message);
  if (current) return current;

  for (let i = priorUserTexts.length - 1; i >= 0; i--) {
    const prior = detectMessageLanguage(priorUserTexts[i]);
    if (prior) return prior;
  }

  return 'en';
}
