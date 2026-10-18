const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

/** 150000 → "₹1,500". Money is always integer paise. */
export function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

/** "1,500.50" / "1500.5" → 150050, or null if not a positive amount. */
export function rupeesToPaise(input: string): number | null {
  const clean = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const paise = Math.round(Number(clean) * 100);
  return paise > 0 ? paise : null;
}
