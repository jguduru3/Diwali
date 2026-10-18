import { addDays, istDate, type Item } from '@pataka/shared';
import i18n from '../i18n';

const locale = () => (i18n.language === 'te' ? 'te-IN' : 'en-IN');

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

/** Item name in the current language. */
export function itemName(item: Pick<Item, 'nameEn' | 'nameTe'>): string {
  return i18n.language === 'te' && item.nameTe ? item.nameTe : item.nameEn;
}

export function categoryName(c: { nameEn: string; nameTe: string | null }): string {
  return i18n.language === 'te' && c.nameTe ? c.nameTe : c.nameEn;
}

/** Days left until Diwali (8 Nov 2026), or null once it has passed. */
export function daysToDiwali(now = new Date()): number | null {
  const diff = Math.ceil((Date.parse('2026-11-08T00:00:00+05:30') - now.getTime()) / 86_400_000);
  return diff >= 0 ? diff : null;
}
