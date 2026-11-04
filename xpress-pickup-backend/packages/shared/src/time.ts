// India has no DST: IST is always UTC+05:30, so plain arithmetic is exact.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** "YYYY-MM-DD" of the given instant in Asia/Kolkata. */
export function istDate(at: Date = new Date()): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "HH:MM" of the given instant in Asia/Kolkata. */
export function istTime(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);
}

/** The instant for a wall-clock date + "HH:MM[:SS]" in Asia/Kolkata. */
export function istInstant(date: string, time: string): Date {
  const [h = '0', m = '0'] = time.split(':');
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  return new Date(utcMidnight + (Number(h) * 60 + Number(m)) * 60_000 - IST_OFFSET_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Start and end instants of an IST calendar day. */
export function istDayRange(date: string): { from: Date; to: Date } {
  return { from: istInstant(date, '00:00'), to: istInstant(addDays(date, 1), '00:00') };
}

/** Great-circle distance in km (SPEC §3: Haversine from browser location or area centroid). */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
