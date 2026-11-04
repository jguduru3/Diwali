import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type Language } from '@pataka/shared';
import { useMe, useSaveLanguage } from '../auth/useAuth';
import { setLanguage } from '../i18n';
import { cx } from './ui';

// Each language is named in its own script so people can find theirs whatever the UI is in.
const NATIVE: Record<Language, { name: string; glyph: string }> = {
  en: { name: 'English', glyph: 'A' },
  te: { name: 'తెలుగు', glyph: 'అ' },
  hi: { name: 'हिन्दी', glyph: 'अ' },
};

function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
    </svg>
  );
}

const MENU_WIDTH = 256; // w-64
const GUTTER = 16;

/** Header pill that opens a small menu of the app's languages. */
export function LanguageMenu() {
  const { i18n, t } = useTranslation();
  const current = (SUPPORTED_LANGUAGES as readonly string[]).includes(i18n.language)
    ? (i18n.language as Language)
    : 'en';
  const [open, setOpen] = useState(false);
  const { data: me } = useMe();
  const save = useSaveLanguage();
  // Menu's left edge relative to the pill. Normally right-aligned with it, but on phones the
  // header wraps and the pill can sit mid-row, so keep the menu a gutter inside the screen.
  const [menuLeft, setMenuLeft] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    options.current[SUPPORTED_LANGUAGES.indexOf(current)]?.focus();
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, current]);

  const choose = (lang: Language) => {
    setLanguage(lang);
    if (me && me.lang !== lang) save.mutate(lang);
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (e.key === 'Tab') return setOpen(false);
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const n = SUPPORTED_LANGUAGES.length;
    const at = options.current.findIndex((o) => o === document.activeElement);
    options.current[(at + step + n) % n]?.focus();
  };

  return (
    <div className="relative" ref={ref} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('nav.language')}
        onClick={() => {
          const rect = trigger.current?.getBoundingClientRect();
          if (rect) {
            const width = Math.min(MENU_WIDTH, window.innerWidth - 2 * GUTTER);
            const left = Math.min(
              Math.max(rect.right - width, GUTTER),
              window.innerWidth - GUTTER - width,
            );
            setMenuLeft(left - rect.left);
          }
          setOpen((o) => !o);
        }}
        className={cx(
          'flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border px-2.5 text-sm font-semibold transition sm:gap-2 sm:px-3.5',
          open
            ? 'border-white/60 bg-white/10 text-white'
            : 'border-white/25 text-white hover:border-white/50 hover:bg-white/10',
        )}
      >
        <span className="text-gold-light">
          <GlobeIcon />
        </span>
        <span className="hidden sm:inline">{NATIVE[current].name}</span>
        <span className="sm:hidden">{NATIVE[current].glyph}</span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={cx(
            'hidden h-4 w-4 text-white/60 transition-transform sm:block',
            open && 'rotate-180',
          )}
          aria-hidden
        >
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>

      {open && (
        <div
          style={{ left: menuLeft }}
          className="absolute top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] origin-top glass rounded-2xl border border-white/60 p-2 text-ink shadow-[var(--shadow-lift)] motion-safe:animate-pop-in"
        >
          <p className="px-3 pb-1.5 pt-1 text-xs font-bold uppercase tracking-wider text-muted">
            {t('languages.title')}
          </p>
          <ul role="listbox" aria-label={t('languages.title')} className="grid gap-1">
            {SUPPORTED_LANGUAGES.map((lang, i) => {
              const selected = lang === current;
              const translated = t(`languages.${lang}`);
              return (
                <li key={lang}>
                  <button
                    ref={(el) => {
                      options.current[i] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(lang)}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-xl p-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-0',
                      selected ? 'bg-brand-050' : 'hover:bg-ivory',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cx(
                        'grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg font-bold',
                        selected ? 'bg-plum text-white' : 'bg-ivory text-plum',
                      )}
                    >
                      {NATIVE[lang].glyph}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span lang={lang} className="block text-sm font-bold">
                        {NATIVE[lang].name}
                      </span>
                      {translated !== NATIVE[lang].name && (
                        <span className="block text-xs text-muted">{translated}</span>
                      )}
                    </span>
                    {selected && (
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-5 w-5 text-gold-deep"
                        aria-hidden
                      >
                        <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
