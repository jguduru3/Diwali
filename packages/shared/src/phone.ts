/** Indian mobile numbers only, stored as E.164 (+91XXXXXXXXXX). */
const E164_IN = /^\+91[6-9]\d{9}$/;

export function isIndianMobileE164(value: string): boolean {
  return E164_IN.test(value);
}

/**
 * Accepts "98765 43210", "09876543210", "919876543210", "+91 98765-43210".
 * Returns E.164 or null if it is not a valid Indian mobile number.
 */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, '');
  let national: string;
  if (/^\+91\d{10}$/.test(digits)) national = digits.slice(3);
  else if (/^91\d{10}$/.test(digits)) national = digits.slice(2);
  else if (/^0\d{10}$/.test(digits)) national = digits.slice(1);
  else if (/^\d{10}$/.test(digits)) national = digits;
  else return null;
  const e164 = `+91${national}`;
  return isIndianMobileE164(e164) ? e164 : null;
}

/** "+919876543210" → "+91 ••••• •3210" for display. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 3)} ••••• •${e164.slice(-4)}`;
}
