import { addDays, istDate, type Item } from '@pataka/shared';
import i18n from '../i18n';

const locales: Record<string, string> = { te: 'te-IN', hi: 'hi-IN' };
const locale = () => locales[i18n.language] ?? 'en-IN';

/** "7:30 pm" in Asia/Kolkata. */
export function timeIST(iso: string | Date): string {
  return new Intl.DateTimeFormat(locale(), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

export function slotRange(startsAt: string, endsAt: string): string {
  return `${timeIST(startsAt)} – ${timeIST(endsAt)}`;
}

/** "Sat, 7 Nov" in Asia/Kolkata. */
export function dayIST(iso: string | Date): string {
  return new Intl.DateTimeFormat(locale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

/** "Sat, 7 Nov, 7:30 pm" in Asia/Kolkata. */
export function dateTimeIST(iso: string | Date): string {
  return `${dayIST(iso)}, ${timeIST(iso)}`;
}

/** Label for a YYYY-MM-DD date tab: Today / Tomorrow / "Sat 7". */
export function dateTab(date: string): { label: string; sub: string } {
  const today = istDate();
  const d = new Date(`${date}T12:00:00+05:30`);
  const sub = new Intl.DateTimeFormat(locale(), {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(d);
  if (date === today) return { label: i18n.t('common.today'), sub };
  if (date === addDays(today, 1)) return { label: i18n.t('common.tomorrow'), sub };
  return {
    label: new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(
      d,
    ),
    sub,
  };
}

type LocalNames = Pick<Item, 'nameEn' | 'nameTe' | 'nameHi'>;

/** Name in the current language, falling back to English when no translation was entered. */
function localName(n: LocalNames): string {
  if (i18n.language === 'te' && n.nameTe) return n.nameTe;
  if (i18n.language === 'hi' && n.nameHi) return n.nameHi;
  return n.nameEn;
}

/** 500 → "500 g", 1500 → "1.5 kg". */
export function formatWeight(grams: number): string {
  return grams < 1000
    ? `${grams} g`
    : `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(grams / 1000)} kg`;
}

/** Item name in the current language. */
export function itemName(item: LocalNames): string {
  return localName(item);
}

export function categoryName(c: LocalNames): string {
  return localName(c);
}

/** Days left until Diwali (8 Nov 2026), or null once it has passed. */
export function daysToDiwali(now = new Date()): number | null {
  const diff = Math.ceil((Date.parse('2026-11-08T00:00:00+05:30') - now.getTime()) / 86_400_000);
  return diff >= 0 ? diff : null;
}
