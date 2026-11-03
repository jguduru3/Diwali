import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import {
  formatOrderCode,
  istDate,
  istDayRange,
  type CounterMethod,
  type FootfallRow,
  type Licence,
  type SalesRecordProductItem,
  type ShopAnalytics,
} from '@pataka/shared';
import type { Db } from '../db/client';
import {
  categories,
  counterPayments,
  dailyShopStats,
  feePayments,
  feeRefunds,
  items,
  orderLines,
  orders,
  shopLicences,
  users,
} from '../db/schema';
import type { ShopRow } from './access';

/**
 * The merchant's own daily numbers: orders placed (fee paid), completed,
 * cancelled, and their sales. Platform fees are not included (G4).
 */
export async function footfall(
  db: Db,
  shopIds: string[],
  from: string,
  to: string,
): Promise<(FootfallRow & { shopId: string })[]> {
  if (!shopIds.length) return [];
  const range = { from: istDayRange(from).from, to: istDayRange(to).to };
  const live = await db
    .select({
      shopId: orders.shopId,
      day: sql<string>`to_char((${orders.feePaidAt} at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD')`,
      orders: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${orders.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) filter (where ${orders.status} in ('cancelled','rejected','expired'))::int`,
      salesPaise: sql<number>`coalesce(sum(${orders.finalTotalPaise}) filter (where ${orders.status} = 'completed'), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        inArray(orders.shopId, shopIds),
        gte(orders.feePaidAt, range.from),
        lt(orders.feePaidAt, range.to),
      ),
    )
    .groupBy(orders.shopId, sql`2`);
  // Stored rows survive the end-of-season purge; live rows win where both exist.
  const stored = await db
    .select()
    .from(dailyShopStats)
    .where(
      and(
        inArray(dailyShopStats.shopId, shopIds),
        gte(dailyShopStats.day, from),
        sql`${dailyShopStats.day} <= ${to}`,
      ),
    );
  const out = new Map<string, FootfallRow & { shopId: string }>();
  for (const s of stored) {
    out.set(`${s.shopId}:${s.day}`, {
      shopId: s.shopId,
      day: s.day,
      orders: s.orders,
      completed: s.completed,
      cancelled: s.cancelled,
      salesPaise: s.salesPaise,
    });
  }
  for (const l of live) out.set(`${l.shopId}:${l.day}`, l);
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function licenceView(
  l: typeof shopLicences.$inferSelect,
  shop: Pick<ShopRow, 'shortCode' | 'name'>,
): Licence {
  return {
    id: l.id,
    shopCode: shop.shortCode,
    shopName: shop.name,
    licenceNo: l.licenceNo,
    licenceType: l.licenceType,
    issuedBy: l.issuedBy,
    validFrom: l.validFrom,
    validTo: l.validTo,
    status: l.status,
    notes: l.notes,
    verifiedAt: l.verifiedAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    hasImage: !!l.imageBlobPath,
  };
}

export interface AnalyticsFilterOptions {
  from?: string;
  to?: string;
  cashierId?: string;
  method?: string;
}

/** Comprehensive merchant sales, payment mode breakdown, product and cashier analytics. */
export async function shopAnalytics(
  db: Db,
  shopId: string,
  options: AnalyticsFilterOptions = {},
): Promise<ShopAnalytics> {
  const today = istDate();
  const from = options.from || today;
  const to = options.to || today;
  const range = { from: istDayRange(from).from, to: istDayRange(to).to };

  // 1. Completed orders and settled counter payments
  const conditions = [
    eq(orders.shopId, shopId),
    eq(orders.status, 'completed'),
    gte(orders.completedAt, range.from),
    lt(orders.completedAt, range.to),
  ];
  if (options.cashierId) {
    conditions.push(eq(counterPayments.takenBy, options.cashierId));
  }
  if (options.method) {
    conditions.push(eq(counterPayments.method, options.method as CounterMethod));
  }

  const completedRows = await db
    .select({
      order: orders,
      payment: counterPayments,
      cashier: {
        id: users.id,
        displayName: users.displayName,
        phoneE164: users.phoneE164,
      },
    })
    .from(orders)
    .innerJoin(
      counterPayments,
      and(eq(counterPayments.orderId, orders.id), eq(counterPayments.status, 'received')),
    )
    .innerJoin(users, eq(users.id, counterPayments.takenBy))
    .where(and(...conditions))
    .orderBy(desc(orders.completedAt));

  const totalSalesPaise = completedRows.reduce(
    (sum, r) => sum + (r.order.finalTotalPaise ?? r.payment.amountPaise),
    0,
  );
  const completedOrders = completedRows.length;
  const averageOrderValuePaise =
    completedOrders > 0 ? Math.round(totalSalesPaise / completedOrders) : 0;

  // 2. Payment breakdown
  let qrCount = 0;
  let qrPaise = 0;
  let cashCount = 0;
  let cashPaise = 0;
  let cardCount = 0;
  let cardPaise = 0;

  for (const r of completedRows) {
    const amt = r.payment.amountPaise;
    if (r.payment.method === 'upi') {
      qrCount++;
      qrPaise += amt;
    } else if (r.payment.method === 'cash') {
      cashCount++;
      cashPaise += amt;
    } else if (r.payment.method === 'card') {
      cardCount++;
      cardPaise += amt;
    }
  }

  const paymentBreakdown = {
    qr: { count: qrCount, totalPaise: qrPaise },
    cash: { count: cashCount, totalPaise: cashPaise },
    card: { count: cardCount, totalPaise: cardPaise },
    totalCollectionsPaise: qrPaise + cashPaise + cardPaise,
  };

  // 3. Product-wise sales
  const completedOrderIds = completedRows.map((r) => r.order.id);
  let totalItemsSold = 0;
  const productMap = new Map<
    string,
    {
      itemId: string;
      itemNo: number;
      nameEn: string;
      nameTe: string | null;
      nameHi: string | null;
      categoryName: string;
      qtySold: number;
      salesPaise: number;
      stockQty: number | null;
      isSoldOut: boolean;
    }
  >();

  const orderLinesByOrder = new Map<string, string[]>();
  const productItemsByOrder = new Map<string, SalesRecordProductItem[]>();

  if (completedOrderIds.length > 0) {
    const lines = await db
      .select({
        line: orderLines,
        item: items,
        category: categories,
      })
      .from(orderLines)
      .innerJoin(items, eq(items.id, orderLines.itemId))
      .innerJoin(categories, eq(categories.id, items.categoryId))
      .where(and(inArray(orderLines.orderId, completedOrderIds), eq(orderLines.status, 'picked')));

    for (const l of lines) {
      const qty = l.line.pickedQty;
      const sales = l.line.unitPricePaise * qty;
      totalItemsSold += qty;

      const summaryList = orderLinesByOrder.get(l.line.orderId) ?? [];
      summaryList.push(`${qty}× ${l.line.nameEn}`);
      orderLinesByOrder.set(l.line.orderId, summaryList);

      const itemsList = productItemsByOrder.get(l.line.orderId) ?? [];
      itemsList.push({
        nameEn: l.line.nameEn,
        nameTe: l.line.nameTe,
        nameHi: l.line.nameHi,
        packDesc: l.line.packDesc,
        qty,
        unitPricePaise: l.line.unitPricePaise,
        totalPaise: sales,
      });
      productItemsByOrder.set(l.line.orderId, itemsList);

      const existing = productMap.get(l.item.id);
      if (existing) {
        existing.qtySold += qty;
        existing.salesPaise += sales;
      } else {
        productMap.set(l.item.id, {
          itemId: l.item.id,
          itemNo: l.item.itemNo,
          nameEn: l.item.nameEn,
          nameTe: l.item.nameTe,
          nameHi: l.item.nameHi,
          categoryName: l.category.nameEn,
          qtySold: qty,
          salesPaise: sales,
          stockQty: l.item.stockQty,
          isSoldOut: l.item.isSoldOut,
        });
      }
    }
  }

  const productSales = [...productMap.values()].sort((a, b) => b.qtySold - a.qtySold);

  // 4. Inventory analytics
  const allItems = await db
    .select({
      item: items,
      category: categories,
    })
    .from(items)
    .innerJoin(categories, eq(categories.id, items.categoryId))
    .where(and(eq(items.shopId, shopId), eq(items.isActive, true)))
    .orderBy(asc(items.itemNo));

  const inventory = allItems.map((ai) => {
    const sold = productMap.get(ai.item.id)?.qtySold ?? 0;
    const stock = ai.item.stockQty;
    const isLowStock = stock != null && stock <= 10;
    return {
      itemId: ai.item.id,
      itemNo: ai.item.itemNo,
      nameEn: ai.item.nameEn,
      nameTe: ai.item.nameTe,
      nameHi: ai.item.nameHi,
      categoryName: ai.category.nameEn,
      pricePaise: ai.item.pricePaise,
      offerPricePaise: ai.item.offerPricePaise,
      stockQty: stock,
      qtySold: sold,
      isSoldOut: ai.item.isSoldOut,
      isLowStock,
    };
  });

  // 5. Cancelled orders and refunds
  const cancelledRows = await db
    .select({
      order: orders,
      feePay: feePayments,
      refund: feeRefunds,
    })
    .from(orders)
    .leftJoin(feePayments, eq(feePayments.orderId, orders.id))
    .leftJoin(feeRefunds, eq(feeRefunds.feePaymentId, feePayments.id))
    .where(
      and(
        eq(orders.shopId, shopId),
        inArray(orders.status, ['cancelled', 'rejected', 'expired']),
        gte(orders.createdAt, range.from),
        lt(orders.createdAt, range.to),
      ),
    );

  const cancelledOrderSet = new Set<string>();
  let refundEligibleCount = 0;
  let refundPendingCount = 0;
  let refundProcessedCount = 0;
  let totalRefundedPaise = 0;
  let totalRefundPendingPaise = 0;

  for (const cr of cancelledRows) {
    cancelledOrderSet.add(cr.order.id);
    if (cr.refund) {
      refundEligibleCount++;
      if (cr.refund.status === 'processed') {
        refundProcessedCount++;
        totalRefundedPaise += cr.refund.amountPaise;
      } else if (cr.refund.status === 'pending') {
        refundPendingCount++;
        totalRefundPendingPaise += cr.refund.amountPaise;
      }
    }
  }

  const cancellationsAndRefunds = {
    cancelledCount: cancelledOrderSet.size,
    refundEligibleCount,
    refundPendingCount,
    refundProcessedCount,
    totalRefundedPaise,
    totalRefundPendingPaise,
  };

  // 6. Cashier-wise reporting
  const cashierMap = new Map<
    string,
    {
      cashierId: string;
      cashierName: string;
      cashierPhone: string;
      transactionsCount: number;
      qrPaise: number;
      cashPaise: number;
      cardPaise: number;
      totalPaise: number;
      lastTransactionAt: string | null;
    }
  >();

  for (const r of completedRows) {
    const cId = r.cashier.id;
    const existing = cashierMap.get(cId);
    const amt = r.payment.amountPaise;
    const txTime = r.order.completedAt?.toISOString() ?? null;
    if (existing) {
      existing.transactionsCount++;
      existing.totalPaise += amt;
      if (r.payment.method === 'upi') existing.qrPaise += amt;
      else if (r.payment.method === 'cash') existing.cashPaise += amt;
      else if (r.payment.method === 'card') existing.cardPaise += amt;
      if (txTime && (!existing.lastTransactionAt || txTime > existing.lastTransactionAt)) {
        existing.lastTransactionAt = txTime;
      }
    } else {
      cashierMap.set(cId, {
        cashierId: cId,
        cashierName: r.cashier.displayName || r.cashier.phoneE164,
        cashierPhone: r.cashier.phoneE164,
        transactionsCount: 1,
        qrPaise: r.payment.method === 'upi' ? amt : 0,
        cashPaise: r.payment.method === 'cash' ? amt : 0,
        cardPaise: r.payment.method === 'card' ? amt : 0,
        totalPaise: amt,
        lastTransactionAt: txTime,
      });
    }
  }
  const cashierReports = [...cashierMap.values()].sort((a, b) => b.totalPaise - a.totalPaise);

  // 7. Individual sales records
  // Fetch customer phones for completed orders
  const customerIds = [...new Set(completedRows.map((r) => r.order.userId))];
  const customerUserRows = customerIds.length
    ? await db
        .select({ id: users.id, phoneE164: users.phoneE164 })
        .from(users)
        .where(inArray(users.id, customerIds))
    : [];
  const customerPhoneMap = new Map(customerUserRows.map((u) => [u.id, u.phoneE164]));

  const salesRecords = completedRows.map((r) => ({
    id: r.order.id,
    transactionId: r.payment.id,
    orderId: r.order.id,
    orderCode: formatOrderCode(r.order.code),
    packNo: r.order.packNo,
    billNo: r.order.billNo,
    completedAt: r.order.completedAt?.toISOString() ?? r.payment.receivedAt?.toISOString() ?? '',
    finalTotalPaise: r.order.finalTotalPaise ?? r.payment.amountPaise,
    paymentMethod: r.payment.method as CounterMethod,
    paymentStatus: r.order.status === 'completed' ? 'paid' : r.order.status,
    paymentReference: r.payment.reference,
    verificationSource: r.payment.verificationSource ?? 'manual',
    cashierName: r.cashier.displayName || r.cashier.phoneE164,
    cashierPhone: r.cashier.phoneE164,
    customerPhone: customerPhoneMap.get(r.order.userId) ?? 'Customer',
    itemsSummary: (orderLinesByOrder.get(r.order.id) ?? []).join(', '),
    refundAmountPaise: 0,
    refundStatus: null,
    items: productItemsByOrder.get(r.order.id) ?? [],
  }));

  // 8. Daily sales trend
  const rawTrend = await footfall(db, [shopId], from, to);
  const salesTrend = rawTrend.map(({ shopId: _s, ...r }) => r);

  return {
    period: { from, to },
    kpis: {
      totalSalesPaise,
      totalCollectionsPaise: paymentBreakdown.totalCollectionsPaise,
      completedOrders,
      totalItemsSold,
      cancelledOrders: cancelledOrderSet.size,
      refundAmountPaise: totalRefundedPaise,
      netCollectionsPaise: paymentBreakdown.totalCollectionsPaise - totalRefundedPaise,
      averageOrderValuePaise,
    },
    paymentBreakdown,
    salesTrend,
    productSales,
    inventory,
    cancellationsAndRefunds,
    cashierReports,
    salesRecords,
  };
}

/** Formats sales records into an Excel-compatible CSV string with UTF-8 BOM. */
export function formatShopAnalyticsCsv(
  analytics: ShopAnalytics,
  shop: Pick<ShopRow, 'shortCode' | 'name'>,
): string {
  const escape = (val: string | number | null | undefined): string => {
    if (val == null) return '';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const metadata = [
    `# Diwali Express Pickup Sales Report - ${escape(shop.name)} (${shop.shortCode})`,
    `# Period: ${analytics.period.from} to ${analytics.period.to}`,
    '',
  ];

  const header = [
    'Transaction ID',
    'Date & Time (IST)',
    'Order Code',
    'Pack No',
    'Bill Number',
    'Customer Phone',
    'Products Summary',
    'Payment Method',
    'Status',
    'Amount (₹)',
    'Payment Reference',
    'Verification Source',
    'Cashier Name',
  ].join(',');

  const rows = analytics.salesRecords.map((r) => {
    const d = r.completedAt
      ? new Date(r.completedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      : '';
    const amt = (r.finalTotalPaise / 100).toFixed(2);
    const method = r.paymentMethod === 'upi' ? 'PhonePe QR' : r.paymentMethod.toUpperCase();
    return [
      escape(r.transactionId || r.id),
      escape(d),
      escape(r.orderCode),
      escape(r.packNo != null ? `#${r.packNo}` : ''),
      escape(r.billNo),
      escape(r.customerPhone),
      escape(r.itemsSummary),
      escape(method),
      escape(r.paymentStatus),
      amt,
      escape(r.paymentReference),
      escape(r.verificationSource),
      escape(r.cashierName),
    ].join(',');
  });

  // UTF-8 BOM (\uFEFF) ensures Excel displays international characters properly
  return '\uFEFF' + [...metadata, header, ...rows].join('\r\n');
}
