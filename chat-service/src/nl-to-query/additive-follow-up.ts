/**
 * Additive follow-up detector — recognises "extend the previous chart"
 * messages ("add in user count per day", "thêm số người chơi", "also show
 * revenue") so the disambiguation pipeline can merge the new member into the
 * session's last executed query instead of resolving the message standalone
 * (session 3542a7c1: standalone resolution produced an off-topic clarify).
 *
 * Conservative by design — markers must anchor near the message start, or
 * take the explicit "add X to the/this chart" shape. Bilingual EN/VI,
 * mirroring the style of `intent-classifier.ts`.
 */

/** Leading additive markers (EN + VI), anchored to the message start. */
const LEADING_ADDITIVE_RE =
  /^\s*(?:please\s+|hãy\s+|cho\s+(?:tôi|mình)\s+)?(add(?:\s+in)?|also\s+(?:show|include|add|chart|plot)|include|plus|show\s+also|overlay|thêm(?:\s+vào)?|bổ\s*sung|cùng\s+với|kèm(?:\s+theo)?)\b/iu;

/** Mid-shape: "add <X> to the chart", "đưa <X> vào biểu đồ". */
const TO_CHART_RE =
  /\b(?:to|onto|into|vào)\s+(?:the\s+|this\s+|cùng\s+)?(?:chart|graph|series|plot|view|biểu\s*đồ|đồ\s*thị)\b/iu;

/** Filler tokens stripped from the residual phrase (keep granularity hints). */
const RESIDUAL_STRIP_RE =
  /\b(?:the|this|that|a|an|in|on|same|chart|graph|series|plot|view|biểu\s*đồ|đồ\s*thị|cùng|của)\b/giu;

export interface AdditiveFollowUp {
  isAdditive: boolean;
  /** Message minus the marker + chart-reference filler — what to resolve. */
  residualPhrase: string;
}

export function detectAdditiveFollowUp(message: string): AdditiveFollowUp {
  const leading = LEADING_ADDITIVE_RE.exec(message);
  if (!leading) return { isAdditive: false, residualPhrase: message };

  let residual = message.slice(leading.index + leading[0].length);
  // Drop the chart-reference tail ("... to the chart") — it names the target,
  // not the member ("per day" stays: granularity hints survive the strip).
  residual = residual.replace(TO_CHART_RE, ' ');
  residual = residual.replace(RESIDUAL_STRIP_RE, ' ').replace(/\s+/g, ' ').trim();

  // A bare marker with nothing to resolve ("add") is not actionable.
  if (residual.length === 0) return { isAdditive: false, residualPhrase: message };

  return { isAdditive: true, residualPhrase: residual };
}

/**
 * Slot-reply-shaped message: short enough that the prior-cube anchor may be
 * applied without hijacking a genuinely new question. Mirrors the ≥3-word
 * `hasSubstantialUnresolvedText` discipline in disambiguate-memory-merge.
 */
export function isFollowUpShaped(message: string): boolean {
  return message.trim().split(/\s+/).filter(Boolean).length <= 6;
}
