import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import type { LocaleCode } from '../types/settings';
import { APP_NAME } from '../brand';
import en from './en.json';
import fr from './fr.json';
import es from './es.json';
import pt from './pt.json';

/**
 * Single source of truth for the languages the app supports, by native label.
 * Feeds BOTH the interface-language dropdown (LanguageSelect) and the
 * scorecard primary/secondary language pickers (SettingsPage). Codes are
 * constrained to `LocaleCode` so this stays in sync with the PDF `LOCALES`
 * table in src/lib/i18n.ts.
 */
export const LANGUAGES: readonly { code: LocaleCode; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
];

export type UILang = LocaleCode;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
      es: { translation: es },
      pt: { translation: pt },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr', 'es', 'pt'],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false, defaultVariables: { app: APP_NAME } },
  });

export default i18n;
