// GST tax invoices for what the platform charges (G3): the customer's platform fee (series XPF,
// numbered when the fee is paid) and the merchant's season subscription (series XPS, numbered when
// it is paid). Both prices include GST; SAC 996211 (see packages/shared/src/invoice.ts).
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  GST_RATE_PERCENT,
  PLATFORM_SAC,
  formatOrderCode,
  gstFromInclusive,
  type TaxInvoice,
} from '@pataka/shared';
import type { Db } from '../db/client';
import { feePayments, feeRefunds, merchantSubscriptions, orders, shops, users } from '../db/schema';
import { env } from './env';
import { HttpError } from './errors';

function supplier(): TaxInvoice['supplier'] {
  const s = env.supplier();
  return {
    name: s.name,
    address: s.address || null,
    gstin: s.gstin || null,
    phone: null,
    stateCode: s.stateCode,
    state: s.state,
  };
}

function totals(totalPaise: number) {
  const g = gstFromInclusive(totalPaise);
  return {
    ratePercent: GST_RATE_PERCENT,
    taxablePaise: g.taxablePaise,
    cgstPaise: g.cgstPaise,
    sgstPaise: g.sgstPaise,
    totalPaise: g.totalPaise,
  };
}

/** The customer's invoice for the platform fee on their own order (once the fee is paid). */
export async function feeInvoice(db: Db, userId: string, orderId: string): Promise<TaxInvoice> {
  const [row] = await db
    .select({ o: orders, shopName: shops.name, name: users.displayName, phone: users.phoneE164 })
    .from(orders)
    .innerJoin(shops, eq(shops.id, orders.shopId))
    .innerJoin(users, eq(users.id, orders.userId))
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
  if (!row) throw new HttpError(404, 'order_not_found', 'No such order');
  const { o } = row;
  if (!o.feeInvoiceNo || !o.feePaidAt)
    throw new HttpError(409, 'no_invoice', 'The invoice is issued once the platform fee is paid');
  const captured = await db
    .select({ id: feePayments.id })
    .from(feePayments)
    .where(and(eq(feePayments.orderId, o.id), eq(feePayments.status, 'captured')));
  const refunds = captured.length
    ? await db
        .select({ status: feeRefunds.status })
        .from(feeRefunds)
        .where(
          inArray(
            feeRefunds.feePaymentId,
            captured.map((c) => c.id),
          ),
        )
        .orderBy(desc(feeRefunds.createdAt))
    : [];
  const code = formatOrderCode(o.code);
  const t = totals(o.feePaise);
  return {
    kind: 'platform_fee',
    invoiceNo: o.feeInvoiceNo,
    issuedAt: o.feePaidAt.toISOString(),
    supplier: supplier(),
    recipient: { name: row.name ?? null, address: null, gstin: null, phone: row.phone },
    placeOfSupply: `${env.supplier().state} (${env.supplier().stateCode})`,
    lines: [
      {
        description: `Platform fee: order ${code} at ${row.shopName}`,
        sac: PLATFORM_SAC,
        qty: 1,
        taxablePaise: t.taxablePaise,
      },
    ],
    ...t,
    reference: code,
    refunded: refunds[0]?.status === 'processed',
  };
}

/** The shop's season subscription invoices (owner), newest first. */
export async function subscriptionInvoices(db: Db, shopId: string): Promise<TaxInvoice[]> {
  const rows = await db
    .select({ s: merchantSubscriptions, shop: shops })
    .from(merchantSubscriptions)
    .innerJoin(shops, eq(shops.id, merchantSubscriptions.shopId))
    .where(and(eq(merchantSubscriptions.shopId, shopId), eq(merchantSubscriptions.status, 'paid')))
    .orderBy(desc(merchantSubscriptions.paidAt));
  return rows
    .filter((r) => r.s.invoiceNo && r.s.paidAt)
    .map(({ s, shop }) => {
      // What was charged, as stored: a subscription paid at the earlier ₹1,999 + GST price keeps
      // its own taxable value and tax rather than being recomputed from today's price.
      const cgst = Math.floor(s.gstPaise / 2);
      const t = {
        ratePercent: GST_RATE_PERCENT,
        taxablePaise: s.amountPaise,
        cgstPaise: cgst,
        sgstPaise: s.gstPaise - cgst,
        totalPaise: s.amountPaise + s.gstPaise,
      };
      return {
        kind: 'subscription' as const,
        invoiceNo: s.invoiceNo!,
        issuedAt: s.paidAt!.toISOString(),
        supplier: supplier(),
        recipient: {
          name: shop.ownerName ? `${shop.name} (${shop.ownerName})` : shop.name,
          address: shop.address ?? null,
          gstin: shop.gstin ?? null,
          phone: null,
        },
        placeOfSupply: `${env.supplier().state} (${env.supplier().stateCode})`,
        lines: [
          {
            description: `Xpress Pickup merchant subscription, season ${s.season}`,
            sac: PLATFORM_SAC,
            qty: 1,
            taxablePaise: t.taxablePaise,
          },
        ],
        ...t,
        reference: shop.shortCode,
        refunded: false,
      };
    });
}
