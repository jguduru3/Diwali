/**
 * Multi-merchant pickup orders (SPEC_V3). The server prices every order from the
 * catalogue and enforces every state change; clients send item ids and
 * quantities only (G11). The platform collects only its flat fee (G3).
 */
import { z } from 'zod';
import { shopCodeSchema } from './domain';
import { MAX_LINE_QTY, VISIT_CODE_ALPHABET } from './qr';

// ---- Platform fee (SPEC_V3 §4) ----

export const PLATFORM_FEE_PAISE = 3000;
/** The merchant must confirm within this window or the fee is refunded. */
export const CONFIRM_WINDOW_HOURS = 72;

export function confirmBy(feePaidAt: Date): Date {
  return new Date(feePaidAt.getTime() + CONFIRM_WINDOW_HOURS * 3_600_000);
}

export const ORDER_STATUSES = [
  'fee_pending',
  'placed',
  'confirmed',
  'packing',
  'awaiting_customer',
  'packed',
  'completed',
  'cancelled',
  'rejected',
  'expired',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const FINAL_ORDER_STATUSES = ['completed', 'cancelled', 'rejected', 'expired'] as const;

export const LINE_STATUSES = [
  'pending',
  'picked',
  'out_of_stock',
  'alternate_proposed',
  'replaced',
  'removed',
] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

export const FEE_PAYMENT_STATUSES = ['created', 'captured', 'failed'] as const;
export const FEE_REFUND_STATUSES = ['pending', 'processed', 'failed'] as const;
export const COUNTER_METHODS = ['upi', 'card', 'cash'] as const;
export type CounterMethod = (typeof COUNTER_METHODS)[number];
export const COUNTER_PAYMENT_STATUSES = ['pending', 'received', 'failed', 'cancelled'] as const;
export type CounterPaymentStatus = (typeof COUNTER_PAYMENT_STATUSES)[number];

/** What happens to the ₹30 for an order in this state. */
export function feeOutcome(order: {
  status: OrderStatus;
  confirmedAt: Date | null;
}): 'none' | 'pending' | 'keep' | 'refund' {
  if (order.status === 'fee_pending') return 'none';
  if (order.confirmedAt) return 'keep';
  if (order.status === 'placed') return 'pending';
  return 'refund';
}

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  fee_pending: ['placed', 'cancelled'],
  placed: ['confirmed', 'rejected', 'expired', 'cancelled'],
  confirmed: ['packing', 'cancelled'],
  packing: ['awaiting_customer', 'packed', 'cancelled'],
  awaiting_customer: ['packing', 'cancelled'],
  packed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  rejected: [],
  expired: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// ---- Pricing ----

/** Offer price while the offer runs and is lower than the price, else the price. */
export function effectivePrice(
  item: { pricePaise: number; offerPricePaise: number | null; offerEndsAt: Date | null },
  now = new Date(),
): number {
  const { pricePaise, offerPricePaise, offerEndsAt } = item;
  if (offerPricePaise == null || offerPricePaise >= pricePaise) return pricePaise;
  if (offerEndsAt && offerEndsAt <= now) return pricePaise;
  return offerPricePaise;
}

export function finalTotal(
  lines: { status: LineStatus; unitPricePaise: number; pickedQty: number }[],
): number {
  return lines
    .filter((l) => l.status === 'picked')
    .reduce((sum, l) => sum + l.unitPricePaise * l.pickedQty, 0);
}

export const needsCustomer = (lines: { status: LineStatus }[]) =>
  lines.some((l) => l.status === 'out_of_stock' || l.status === 'alternate_proposed');

export const readyToPack = (lines: { status: LineStatus }[]) =>
  lines.every((l) => l.status === 'picked' || l.status === 'removed' || l.status === 'replaced') &&
  lines.some((l) => l.status === 'picked');

// ---- QR codes (opaque; stored as hashes) ----

export const ORDER_SECRET_LENGTH = 26;
export const ORDER_CODE_LENGTH = 6;
export const ORDER_ALPHABET = VISIT_CODE_ALPHABET;
export const ORDER_QR_PREFIX = { customer: 'DXO1', pack: 'DXK1' } as const;
export type OrderQrKind = keyof typeof ORDER_QR_PREFIX;
const SECRET_RE = new RegExp(`^[0-9A-HJKMNP-TV-Z]{${ORDER_SECRET_LENGTH}}$`);

export function encodeOrderQr(kind: OrderQrKind, secret: string): string {
  if (!SECRET_RE.test(secret)) throw new Error('Invalid QR secret');
  return `${ORDER_QR_PREFIX[kind]}.${secret}`;
}

export function parseOrderQr(text: string): { kind: OrderQrKind; secret: string } | null {
  const s = text.trim().toUpperCase().replace(/\s/g, '');
  for (const kind of ['customer', 'pack'] as const) {
    const prefix = `${ORDER_QR_PREFIX[kind]}.`;
    if (s.startsWith(prefix)) {
      const secret = s.slice(prefix.length).replace(/-/g, '');
      return SECRET_RE.test(secret) ? { kind, secret } : null;
    }
  }
  return null;
}

/** "K7Q2M9" → "K7Q-2M9" */
export const formatOrderCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`;

/** Staff see only the last four digits (G9). */
export const staffPhoneMask = (phoneE164: string) =>
  /^\+\d{10,}$/.test(phoneE164) ? `••••••${phoneE164.slice(-4)}` : '••••••';

// ---- Request bodies (all strict: no prices, totals or statuses from clients) ----

export const MAX_ORDER_LINES = 40;

export const placeOrderSchema = z
  .object({
    shopCode: shopCodeSchema,
    lines: z
      .array(
        z
          .object({
            itemId: z.string().uuid(),
            qty: z.number().int().min(1).max(MAX_LINE_QTY),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_ORDER_LINES)
      .refine((ls) => new Set(ls.map((l) => l.itemId)).size === ls.length, {
        message: 'Each item once',
      }),
  })
  .strict();
export type PlaceOrder = z.input<typeof placeOrderSchema>;

export const customerDecisionSchema = z
  .object({ lineId: z.string().uuid(), decision: z.enum(['remove', 'accept', 'decline']) })
  .strict();
export type CustomerDecision = z.input<typeof customerDecisionSchema>;

export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
export const optionalReasonSchema = z
  .object({ reason: z.string().trim().max(300).optional() })
  .strict();

export const packScanSchema = z.object({ barcode: z.string().trim().min(1).max(64) }).strict();
export const lineRefSchema = z.object({ lineId: z.string().uuid() }).strict();
export const proposeAlternateSchema = z
  .object({
    lineId: z.string().uuid(),
    itemId: z.string().uuid(),
    qty: z.number().int().min(1).max(MAX_LINE_QTY),
  })
  .strict();
export type ProposeAlternate = z.input<typeof proposeAlternateSchema>;

export const qrInputSchema = z.object({ qr: z.string().trim().min(1).max(80) }).strict();
export const cardPaymentSchema = z
  .object({
    approvalCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{4,20}$/, 'Approval code'),
  })
  .strict();
export const cashPaymentSchema = z
  .object({ receivedPaise: z.number().int().positive().max(100_000_000) })
  .strict();

export const merchantPaymentSettingsSchema = z
  .object({
    youpiBaseUrl: z.string().trim().url().max(200).nullable(),
    youpiMerchantId: z.string().trim().max(80).nullable(),
    /** write-only; omit to keep the stored secret */
    youpiWebhookSecret: z.string().min(16).max(200).optional(),
    upiVpa: z
      .string()
      .trim()
      .regex(/^[\w.-]{2,64}@[\w.-]{2,64}$/, 'UPI ID like shop@bank')
      .nullable(),
    acceptsCard: z.boolean(),
    acceptsCash: z.boolean(),
  })
  .strict();
export type MerchantPaymentSettingsInput = z.input<typeof merchantPaymentSettingsSchema>;

// ---- Response shapes ----

const iso = z.string();
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export const lineStatusSchema = z.enum(LINE_STATUSES);
export const counterMethodSchema = z.enum(COUNTER_METHODS);

export const orderLineSchema = z.object({
  id: z.string().uuid(),
  lineNo: z.number(),
  itemId: z.string().uuid(),
  itemNo: z.number(),
  nameEn: z.string(),
  nameTe: z.string().nullable(),
  packDesc: z.string().nullable(),
  imageUrl: z.string().nullable(),
  qty: z.number(),
  unitPricePaise: z.number(),
  status: lineStatusSchema,
  pickedQty: z.number(),
  /** set on a line that replaced another */
  replacesLineId: z.string().uuid().nullable(),
  alternate: z
    .object({
      itemId: z.string().uuid(),
      nameEn: z.string(),
      nameTe: z.string().nullable(),
      packDesc: z.string().nullable(),
      unitPricePaise: z.number(),
      qty: z.number(),
    })
    .nullable(),
});
export type OrderLine = z.infer<typeof orderLineSchema>;

export const feeStateSchema = z.object({
  amountPaise: z.number(),
  status: z.enum(['unpaid', 'paid', 'kept', 'refund_pending', 'refunded', 'refund_failed']),
  checkout: z.object({ provider: z.string(), checkoutId: z.string(), url: z.string() }).nullable(),
});
export type FeeState = z.infer<typeof feeStateSchema>;

export const billSchema = z.object({
  billNo: z.string(),
  issuedAt: iso,
  orderCode: z.string(),
  shop: z.object({
    name: z.string(),
    address: z.string().nullable(),
    licenceNo: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  lines: z.array(
    z.object({
      nameEn: z.string(),
      qty: z.number(),
      unitPricePaise: z.number(),
      totalPaise: z.number(),
    }),
  ),
  totalPaise: z.number(),
  payment: z.object({ method: counterMethodSchema, reference: z.string().nullable() }),
});
export type Bill = z.infer<typeof billSchema>;

export const customerOrderSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: orderStatusSchema,
  shop: z.object({
    shortCode: z.string(),
    name: z.string(),
    address: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    pickupNotes: z.string().nullable(),
  }),
  lines: z.array(orderLineSchema),
  estimatedTotalPaise: z.number(),
  finalTotalPaise: z.number().nullable(),
  packNo: z.number().nullable(),
  fee: feeStateSchema,
  placedAt: iso.nullable(),
  confirmBy: iso.nullable(),
  confirmedAt: iso.nullable(),
  packedAt: iso.nullable(),
  completedAt: iso.nullable(),
  cancelReason: z.string().nullable(),
  bill: billSchema.nullable(),
});
export type CustomerOrder = z.infer<typeof customerOrderSchema>;

export const customerOrderSummarySchema = customerOrderSchema
  .pick({
    id: true,
    code: true,
    status: true,
    estimatedTotalPaise: true,
    finalTotalPaise: true,
    placedAt: true,
    packNo: true,
  })
  .extend({ shopName: z.string(), lineCount: z.number() });
export type CustomerOrderSummary = z.infer<typeof customerOrderSummarySchema>;

export const orderQrResponseSchema = z.object({ orderId: z.string().uuid(), qr: z.string() });

export const counterPaymentSchema = z.object({
  id: z.string().uuid(),
  method: counterMethodSchema,
  status: z.enum(COUNTER_PAYMENT_STATUSES),
  amountPaise: z.number(),
  reference: z.string().nullable(),
  /** UPI: link the customer opens to pay the merchant (shown as a QR) */
  payUrl: z.string().nullable(),
  changePaise: z.number().nullable(),
});
export type CounterPayment = z.infer<typeof counterPaymentSchema>;

export const staffOrderLineSchema = orderLineSchema.extend({
  barcode: z.string().nullable(),
  rackCode: z.string().nullable(),
  stockQty: z.number().nullable(),
});
export type StaffOrderLine = z.infer<typeof staffOrderLineSchema>;

export const staffOrderSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: orderStatusSchema,
  customer: z.string(),
  lines: z.array(staffOrderLineSchema),
  estimatedTotalPaise: z.number(),
  finalTotalPaise: z.number().nullable(),
  packNo: z.number().nullable(),
  placedAt: iso.nullable(),
  confirmBy: iso.nullable(),
  confirmedAt: iso.nullable(),
  packedAt: iso.nullable(),
  completedAt: iso.nullable(),
  packMatched: z.boolean(),
  counterPayment: counterPaymentSchema.nullable(),
  bill: billSchema.nullable(),
});
export type StaffOrder = z.infer<typeof staffOrderSchema>;

export const staffOrderSummarySchema = staffOrderSchema
  .pick({
    id: true,
    code: true,
    status: true,
    customer: true,
    estimatedTotalPaise: true,
    packNo: true,
    placedAt: true,
    confirmBy: true,
  })
  .extend({ lineCount: z.number(), openDecisions: z.number() });
export type StaffOrderSummary = z.infer<typeof staffOrderSummarySchema>;

/** Returned once when packing finishes (and on reprint) for the sticker. */
export const packStickerSchema = z.object({
  orderId: z.string().uuid(),
  code: z.string(),
  packNo: z.number(),
  qr: z.string(),
  itemCount: z.number(),
});
export type PackSticker = z.infer<typeof packStickerSchema>;

export const merchantPaymentSettingsViewSchema = z.object({
  youpiBaseUrl: z.string().nullable(),
  youpiMerchantId: z.string().nullable(),
  hasWebhookSecret: z.boolean(),
  upiVpa: z.string().nullable(),
  acceptsCard: z.boolean(),
  acceptsCash: z.boolean(),
  webhookUrl: z.string(),
});
export type MerchantPaymentSettings = z.infer<typeof merchantPaymentSettingsViewSchema>;

export const mockCheckoutSchema = z.object({
  checkoutId: z.string(),
  amountPaise: z.number(),
  orderCode: z.string(),
  status: z.enum(FEE_PAYMENT_STATUSES),
});
export type MockCheckout = z.infer<typeof mockCheckoutSchema>;
export const mockCompleteSchema = z.object({ outcome: z.enum(['success', 'fail']) }).strict();

export const gateLookupSchema = z.object({
  code: z.string(),
  status: orderStatusSchema,
  shopCode: z.string(),
  shopName: z.string(),
  packNo: z.number().nullable(),
  sameGround: z.boolean(),
});
export type GateLookup = z.infer<typeof gateLookupSchema>;

export const adminOrderSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: orderStatusSchema,
  shopCode: z.string(),
  shopName: z.string(),
  customer: z.string(),
  placedAt: iso.nullable(),
  confirmBy: iso.nullable(),
  finalTotalPaise: z.number().nullable(),
  fee: feeStateSchema.omit({ checkout: true }),
});
export type AdminOrder = z.infer<typeof adminOrderSchema>;
