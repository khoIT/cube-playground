import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Lang, SUPPORTED_LANGUAGES } from './index';

export type UseLangResult = {
  lang: Lang;
  setLang: (next: Lang) => void;
  toggle: () => void;
};

function normalize(raw: string | undefined): Lang {
  if (raw && (SUPPORTED_LANGUAGES as readonly string[]).includes(raw)) {
    return raw as Lang;
  }
  return 'en';
}

export function useLang(): UseLangResult {
  const { i18n } = useTranslation();
  const lang = normalize(i18n.language);

  const setLang = useCallback(
    (next: Lang) => {
      void i18n.changeLanguage(next);
    },
    [i18n]
  );

  const toggle = useCallback(() => {
    setLang(lang === 'en' ? 'vi' : 'en');
  }, [lang, setLang]);

  return { lang, setLang, toggle };
}
