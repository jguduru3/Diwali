import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type Language } from '@pataka/shared';
import en from './en.json';
import te from './te.json';
import hi from './hi.json';

const LANG_KEY = 'pp.lang';

const isLanguage = (v: string | null | undefined): v is Language =>
  !!v && (SUPPORTED_LANGUAGES as readonly string[]).includes(v);

function savedLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    return isLanguage(saved) ? saved : null;
  } catch {
    return null; // storage unavailable
  }
}

/** First visit: the phone's own language when it is Telugu or Hindi, else English. */
function deviceLanguage(): Language {
  const langs =
    typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  for (const l of langs) {
    const base = l?.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

function initialLanguage(): Language {
  return savedLanguage() ?? deviceLanguage();
}

/** The language the screens are in now. */
export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : 'en';
}

/** True once the person picked a language on this device (not just the phone's default). */
export function hasChosenLanguage(): boolean {
  return savedLanguage() !== null;
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
  resources: { en: { translation: en }, te: { translation: te }, hi: { translation: hi } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language;

export default i18n;
