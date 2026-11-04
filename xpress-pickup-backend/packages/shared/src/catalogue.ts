// Catalogue rules shared by the API (which enforces them) and the web (which previews them):
// how a product is priced in each sale mode, and the shop's own in-store barcodes.

/**
 * How a product is sold. Every product has exactly one mode (never null):
 * - `mrp`  — normal / pack sale at the printed MRP: price and offer price per pack.
 * - `kilo` — sold by weight: a rate per kg and offer rate per kg, packed in fixed-weight packs.
 */
export const SALE_MODES = ['mrp', 'kilo'] as const;
export type SaleMode = (typeof SALE_MODES)[number];

export const MAX_PRICE_PAISE = 10_000_000;
export const MAX_WEIGHT_GRAMS = 100_000;

/** Price of one kilo pack: rate per kg × pack weight, rounded to the nearest paisa (half up). */
export function kiloUnitPaise(perKgPaise: number, grams: number): number {
  return Math.round((perKgPaise * grams) / 1000);
}

export type PricingInput = {
  saleMode: SaleMode;
  pricePaise?: number | null;
  offerPricePaise?: number | null;
  pricePerKgPaise?: number | null;
  offerPricePerKgPaise?: number | null;
  weightGrams?: number | null;
};

/** What is stored on the product. `pricePaise` / `offerPricePaise` are always per pack —
 *  the unit the cart, orders, stock and bills count — so ordering is the same in both modes. */
export type Pricing = {
  saleMode: SaleMode;
  pricePaise: number;
  offerPricePaise: number | null;
  pricePerKgPaise: number | null;
  offerPricePerKgPaise: number | null;
  weightGrams: number | null;
};

export type PricingError =
  'price_required' | 'weight_required' | 'offer_not_lower' | 'price_too_low';

export type PricingResult =
  { ok: true; value: Pricing } | { ok: false; code: PricingError; message: string };

const fail = (code: PricingError, message: string): PricingResult => ({ ok: false, code, message });

/** The one place that turns what the owner typed into stored prices, for both sale modes. */
export function resolvePricing(p: PricingInput): PricingResult {
  if (p.saleMode === 'mrp') {
    const price = p.pricePaise;
    if (!price || price <= 0) return fail('price_required', 'Enter the price (MRP)');
    const offer = p.offerPricePaise ?? null;
    if (offer != null && (offer <= 0 || offer >= price)) {
      return fail('offer_not_lower', 'Offer price must be lower than the price');
    }
    return {
      ok: true,
      value: {
        saleMode: 'mrp',
        pricePaise: price,
        offerPricePaise: offer,
        pricePerKgPaise: null,
        offerPricePerKgPaise: null,
        weightGrams: null,
      },
    };
  }

  const grams = p.weightGrams;
  const perKg = p.pricePerKgPaise;
  if (!perKg || perKg <= 0) return fail('price_required', 'Enter the price per kg');
  if (!grams || grams <= 0 || grams > MAX_WEIGHT_GRAMS) {
    return fail('weight_required', 'Enter the weight of one pack');
  }
  const unit = kiloUnitPaise(perKg, grams);
  if (unit < 1) return fail('price_too_low', 'The pack price is below one paisa');
  const offerPerKg = p.offerPricePerKgPaise ?? null;
  let offerUnit: number | null = null;
  if (offerPerKg != null) {
    offerUnit = kiloUnitPaise(offerPerKg, grams);
    if (offerPerKg <= 0 || offerPerKg >= perKg || offerUnit < 1 || offerUnit >= unit) {
      return fail('offer_not_lower', 'Offer price per kg must be lower than the price per kg');
    }
  }
  return {
    ok: true,
    value: {
      saleMode: 'kilo',
      pricePaise: unit,
      offerPricePaise: offerUnit,
      pricePerKgPaise: perKg,
      offerPricePerKgPaise: offerPerKg,
      weightGrams: grams,
    },
  };
}

// ---- Barcodes ----

/** GS1 check digit for the first 12 digits of an EAN-13. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('EAN-13 needs 12 digits before the check digit');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/**
 * A new in-store barcode: EAN-13 with the GS1 "restricted circulation" prefix 20, so it can
 * never clash with a manufacturer's code, plus 10 random digits and the check digit.
 * Unique per shop is enforced by the database; callers retry on a clash.
 */
export function generateStoreBarcode(random: () => number = secureRandom): string {
  let body = '20';
  for (let i = 0; i < 10; i++) body += Math.floor(random() * 10) % 10;
  return body + ean13CheckDigit(body);
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0]! / 2 ** 32;
}

const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

/** The 95 bar modules of an EAN-13 ('1' = bar), for drawing printable labels. */
export function ean13Modules(code: string): string {
  if (!isValidEan13(code)) throw new Error('Not a valid EAN-13');
  const d = [...code].map(Number);
  const parity = PARITY[d[0]!]!;
  let out = '101';
  for (let i = 1; i <= 6; i++) out += (parity[i - 1] === 'L' ? L : G)[d[i]!]!;
  out += '01010';
  for (let i = 7; i <= 12; i++) out += R[d[i]!]!;
  return out + '101';
}
