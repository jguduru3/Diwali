/**
 * Ticket QR payload (SPEC §7). One QR carries the visit code and the plan list.
 *
 *   PP1.<VISITCODE>.<SHOPCODE>.<PRICEVER>.<ITEMS>
 *   ITEMS = <itemNo base36>*<qty base36> joined by "-"   (max 40 lines, qty 1–99)
 *
 * Only QR alphanumeric characters are used so long lists still scan fast at night.
 * Walk-in lists (no slot) use "-" as the visit code.
 */

export const QR_PREFIX = 'PP1';
export const MAX_PLAN_LINES = 40;
export const MAX_LINE_QTY = 99;
export const WALK_IN = '-';

/** Crockford base32 without I, L, O, U. */
export const VISIT_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const VISIT_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{6}$/;
const SHOP_CODE_RE = /^[A-Z0-9]{3,6}$/;
const BASE36_RE = /^[0-9A-Z]+$/;

export type PlanLine = { itemNo: number; qty: number };

export type PlanPayload = {
  /** null for a walk-in list */
  visitCode: string | null;
  shopCode: string;
  priceVersion: number;
  lines: PlanLine[];
};

export type DecodeError =
  | 'bad_prefix'
  | 'bad_format'
  | 'bad_visit_code'
  | 'bad_shop_code'
  | 'bad_price_version'
  | 'bad_line'
  | 'bad_qty'
  | 'duplicate_item'
  | 'too_many_lines';

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function isVisitCode(code: string): boolean {
  return VISIT_CODE_RE.test(code);
}

/** Adds quantities of repeated items, drops empty lines, sorts by item number. */
export function normalizeLines(lines: PlanLine[]): PlanLine[] {
  const byItem = new Map<number, number>();
  for (const { itemNo, qty } of lines) {
    if (qty > 0) byItem.set(itemNo, (byItem.get(itemNo) ?? 0) + qty);
  }
  return [...byItem.entries()]
    .sort(([a], [b]) => a - b)
    .map(([itemNo, qty]) => ({ itemNo, qty: Math.min(qty, MAX_LINE_QTY) }));
}

export function encodePlan(plan: PlanPayload): string {
  const visit = plan.visitCode ?? WALK_IN;
  if (visit !== WALK_IN && !isVisitCode(visit)) throw new Error('Invalid visit code');
  if (!SHOP_CODE_RE.test(plan.shopCode)) throw new Error('Invalid shop code');
  if (!Number.isInteger(plan.priceVersion) || plan.priceVersion < 1) {
    throw new Error('Invalid price version');
  }
  const lines = normalizeLines(plan.lines);
  if (lines.length > MAX_PLAN_LINES) throw new Error(`At most ${MAX_PLAN_LINES} items`);
  for (const l of lines) {
    if (!Number.isInteger(l.itemNo) || l.itemNo < 1) throw new Error('Invalid item number');
  }
  const items = lines
    .map((l) => `${l.itemNo.toString(36)}*${l.qty.toString(36)}`.toUpperCase())
    .join('-');
  return [
    QR_PREFIX,
    visit,
    plan.shopCode,
    plan.priceVersion.toString(36).toUpperCase(),
    items,
  ].join('.');
}

function parseBase36(s: string): number | null {
  if (!BASE36_RE.test(s)) return null;
  const n = parseInt(s, 36);
  return Number.isSafeInteger(n) ? n : null;
}

export function decodePlan(text: string): Result<PlanPayload, DecodeError> {
  const fail = (error: DecodeError) => ({ ok: false, error }) as const;
  const raw = text.trim().toUpperCase();
  const parts = raw.split('.');
  if (parts[0] !== QR_PREFIX) return fail('bad_prefix');
  if (parts.length !== 5) return fail('bad_format');
  const [, visit, shopCode, ver, items] = parts as [string, string, string, string, string];

  if (visit !== WALK_IN && !isVisitCode(visit)) return fail('bad_visit_code');
  if (!SHOP_CODE_RE.test(shopCode)) return fail('bad_shop_code');
  const priceVersion = parseBase36(ver);
  if (priceVersion === null || priceVersion < 1) return fail('bad_price_version');

  const lines: PlanLine[] = [];
  const seen = new Set<number>();
  if (items !== '') {
    const chunks = items.split('-');
    if (chunks.length > MAX_PLAN_LINES) return fail('too_many_lines');
    for (const chunk of chunks) {
      const [a, b, ...rest] = chunk.split('*');
      if (a === undefined || b === undefined || rest.length) return fail('bad_line');
      const itemNo = parseBase36(a);
      const qty = parseBase36(b);
      if (itemNo === null || itemNo < 1) return fail('bad_line');
      if (qty === null || qty < 1 || qty > MAX_LINE_QTY) return fail('bad_qty');
      if (seen.has(itemNo)) return fail('duplicate_item');
      seen.add(itemNo);
      lines.push({ itemNo, qty });
    }
  }
  return {
    ok: true,
    value: { visitCode: visit === WALK_IN ? null : visit, shopCode, priceVersion, lines },
  };
}
