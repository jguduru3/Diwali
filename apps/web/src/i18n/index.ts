import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type Language } from '@pataka/shared';
import en from './en.json';
import te from './te.json';

const LANG_KEY = 'pp.lang';

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && (SUPPORTED_LANGUAGES as readonly string[]).includes(saved))
      return saved as Language;
  } catch {
    // storage unavailable
  }
  return 'en';
}

export function setLanguage(lang: Language) {
  void i18n.changeLanguage(lang);
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // storage unavailable
  }
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, te: { translation: te } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

export default i18n;
