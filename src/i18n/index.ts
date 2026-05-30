import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { setPref } from '../hooks/server-prefs-store';
import en from './locales/en.json';
import vi from './locales/vi.json';

export const LANG_STORAGE_KEY = 'gds-cube:lang';
export const SUPPORTED_LANGUAGES = ['en', 'vi'] as const;
export type Lang = (typeof SUPPORTED_LANGUAGES)[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en },
      vi: { common: vi },
    },
    ns: ['common'],
    defaultNS: 'common',
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ['localStorage'],
    },
    react: {
      useSuspense: false,
    },
  });

i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', lng);
  }
  // Persist language selection to the server so it follows the user across devices.
  // i18next-browser-languagedetector continues to read LANG_STORAGE_KEY from
  // localStorage on init (the mirror is byte-identical), so detection is unchanged.
  setPref(LANG_STORAGE_KEY, lng);
});

if (typeof document !== 'undefined' && i18n.language) {
  document.documentElement.setAttribute('lang', i18n.language);
}

export default i18n;
