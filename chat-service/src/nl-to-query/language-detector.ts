/**
 * Quick-and-dirty language detector for the chat input. Looks at the share
 * of Vietnamese-diacritic characters and code-switched markers — good enough
 * to drive the synonym resolver's alias-language preference. Not meant for
 * general translation.
 */

import type { EngineLanguage } from './types.js';

const VI_DIACRITICS = /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠÂẦẤẨẪẬĂẰẮẲẴẶÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/u;

const VI_FUNCTION_WORDS = [
  'của', 'và', 'là', 'trong', 'theo', 'cho', 'từ', 'với', 'những',
  'này', 'đó', 'bao nhiêu', 'có', 'không', 'đã', 'sẽ',
];

export function detectLanguage(message: string): EngineLanguage {
  const text = message.trim();
  if (!text) return 'en';

  let viChars = 0;
  let asciiLetters = 0;
  for (const ch of text) {
    if (VI_DIACRITICS.test(ch)) viChars += 1;
    else if (/[a-zA-Z]/.test(ch)) asciiLetters += 1;
  }

  const lower = text.toLowerCase();
  const hasViFunction = VI_FUNCTION_WORDS.some((w) => lower.includes(w));

  const total = viChars + asciiLetters;
  if (total === 0) return 'en';

  const viRatio = viChars / total;

  if (viRatio === 0 && !hasViFunction) return 'en';
  if (viRatio > 0.2) return 'vi';
  // No diacritics but has VI function words — likely VI typed without marks.
  if (hasViFunction && asciiLetters > 0 && viChars === 0) return 'mixed';
  if (viChars > 0 && asciiLetters > viChars) return 'mixed';
  return 'vi';
}
