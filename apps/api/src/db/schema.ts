// Data model (SPEC §6, SPEC_V3 §9). Orders are priced by the server (G11); the
// platform's only revenue is its flat fee (G3, G4).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  COUNTER_METHODS,
  COUNTER_PAYMENT_STATUSES,
  FEE_PAYMENT_STATUSES,
  FEE_REFUND_STATUSES,
  GREEN_CERTS,
  LICENCE_STATUSES,
  LINE_STATUSES,
  ORDER_STATUSES,
  ROLES,
  SALE_UNITS,
} from '@pataka/shared';

export const userRole = pgEnum('user_role', ROLES);
export const licenceStatus = pgEnum('licence_status', LICENCE_STATUSES);
export const greenCertType = pgEnum('green_cert_type', GREEN_CERTS);
export const orderStatus = pgEnum('order_status', ORDER_STATUSES);
export const lineStatus = pgEnum('line_status', LINE_STATUSES);
export const feePaymentStatus = pgEnum('fee_payment_status', FEE_PAYMENT_STATUSES);
export const feeRefundStatus = pgEnum('fee_refund_status', FEE_REFUND_STATUSES);
export const counterMethod = pgEnum('counter_method', COUNTER_METHODS);
export const counterPaymentStatus = pgEnum('counter_payment_status', COUNTER_PAYMENT_STATUSES);
export const saleUnit = pgEnum('sale_unit', SALE_UNITS);

const tz = (name: string) => timestamp(name, { withTimezone: true });
const id = () => uuid('id').primaryKey().defaultRandom();
const stamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---- People ----

export const users = pgTable('users', {
  id: id(),
  phoneE164: text('phone_e164').notNull().unique(),
  displayName: text('display_name'),
  role: userRole('role').notNull().default('customer'),
  blockedUntil: tz('blocked_until'),
  /** Bumped on logout / delete / role change; JWTs carrying an older value are rejected. */
  tokenVersion: integer('token_version').notNull().default(0),
  deletedAt: tz('deleted_at'),
  ...stamps,
});

export const consents = pgTable('consents', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  purpose: text('purpose').notNull(),
  version: text('version').notNull(),
  grantedAt: tz('granted_at').notNull().defaultNow(),
  withdrawnAt: tz('withdrawn_at'),
  ...stamps,
});

export const otpRequests = pgTable(
  'otp_requests',
  {
    id: id(),
    phoneE164: text('phone_e164').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: tz('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: tz('consumed_at'),
    ip: inet('ip'),
    ...stamps,
  },
  (t) => [index('otp_requests_phone_idx').on(t.phoneE164, t.createdAt)],
);

// ---- Places (minimal columns now; licence/catalogue in Phase 1) ----

export const clusters = pgTable('clusters', {
  id: id(),
  name: text('name').notNull(),
  area: text('area').notNull(),
  lat: numeric('lat', { precision: 9, scale: 6, mode: 'number' }),
  lng: numeric('lng', { precision: 9, scale: 6, mode: 'number' }),
  address: text('address'),
  gateNotes: text('gate_notes'),
  isActive: boolean('is_active').notNull().default(true),
  ...stamps,
});

export const shops = pgTable(
  'shops',
  {
    id: id(),
    clusterId: uuid('cluster_id').references(() => clusters.id),
    shortCode: text('short_code').notNull().unique(),
    name: text('name').notNull(),
    area: text('area').notNull(),
    lat: numeric('lat', { precision: 9, scale: 6, mode: 'number' }),
    lng: numeric('lng', { precision: 9, scale: 6, mode: 'number' }),
    address: text('address'),
    phoneE164: text('phone_e164'),
    photoUrl: text('photo_url'),
    openFrom: time('open_from'),
    openTo: time('open_to'),
    isLive: boolean('is_live').notNull().default(false),
    ...stamps,
  },
  (t) => [check('shops_short_code_format', sql`${t.shortCode} ~ '^[A-Z0-9]{3,6}$'`)],
);

export const shopMembers = pgTable(
  'shop_members',
  {
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: userRole('role').notNull(),
    ...stamps,
  },
  (t) => [
    primaryKey({ columns: [t.shopId, t.userId] }),
    check(
      'shop_members_role',
      sql`${t.role}::text in ('shop_owner','shop_staff','shop_packer','shop_cashier')`,
    ),
  ],
);

export const clusterMarshals = pgTable(
  'cluster_marshals',
  {
    clusterId: uuid('cluster_id')
      .notNull()
      .references(() => clusters.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    ...stamps,
  },
  (t) => [primaryKey({ columns: [t.clusterId, t.userId] })],
);

// ---- Ops ----

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: tz('window_start').notNull(),
  count: integer('count').notNull().default(0),
});

export const auditLog = pgTable('audit_log', {
  id: id(),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: uuid('entity_id'),
  meta: jsonb('meta'),
  at: tz('at').notNull().defaultNow(),
});

// ---- Licences ----

export const shopLicences = pgTable(
  'shop_licences',
  {
    id: id(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    licenceNo: text('licence_no').notNull(),
    licenceType: text('licence_type').notNull(),
    issuedBy: text('issued_by'),
    validFrom: date('valid_from'),
    validTo: date('valid_to').notNull(),
    imageBlobPath: text('image_blob_path').notNull(),
    status: licenceStatus('status').notNull().default('pending'),
    verifiedBy: uuid('verified_by').references(() => users.id),
    verifiedAt: tz('verified_at'),
    notes: text('notes'),
    ...stamps,
  },
  (t) => [index('shop_licences_shop_idx').on(t.shopId)],
);

// ---- Catalogue ----

export const categories = pgTable('categories', {
  id: id(),
  slug: text('slug').notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameTe: text('name_te'),
  sort: integer('sort').notNull().default(0),
  isBanned: boolean('is_banned').notNull().default(false),
  bannedReason: text('banned_reason'),
  ...stamps,
});

export const items = pgTable(
  'items',
  {
    id: id(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    /** small per-shop number used in the QR */
    itemNo: integer('item_no').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    nameEn: text('name_en').notNull(),
    nameTe: text('name_te'),
    packDesc: text('pack_desc'),
    /** per pack, or per kg when sale_unit is kg / mix_kg */
    pricePaise: integer('price_paise').notNull(),
    saleUnit: saleUnit('sale_unit').notNull().default('pack'),
    /** shop price version at the last price change; counters flag lists older than this */
    priceVersion: integer('price_version').notNull().default(1),
    greenCert: greenCertType('green_cert').notNull(),
    greenRef: text('green_ref').notNull(),
    rackCode: text('rack_code'),
    imageUrl: text('image_url'),
    /** product photo in the shop-media store (served by /api/media) */
    imagePath: text('image_path'),
    barcode: text('barcode'),
    /** null = stock not tracked; units for pack items, grams for kg items */
    stockQty: integer('stock_qty'),
    offerPricePaise: integer('offer_price_paise'),
    offerEndsAt: tz('offer_ends_at'),
    isSoldOut: boolean('is_sold_out').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...stamps,
  },
  (t) => [
    uniqueIndex('items_shop_item_no').on(t.shopId, t.itemNo),
    uniqueIndex('items_shop_barcode').on(t.shopId, t.barcode),
    check('items_stock_nonneg', sql`${t.stockQty} is null or ${t.stockQty} >= 0`),
    check(
      'items_offer_lower',
      sql`${t.offerPricePaise} is null or (${t.offerPricePaise} > 0 and ${t.offerPricePaise} < ${t.pricePaise})`,
    ),
    check('items_price_positive', sql`${t.pricePaise} > 0`),
    check('items_item_no_positive', sql`${t.itemNo} > 0`),
    check('items_green_ref_present', sql`length(trim(${t.greenRef})) >= 2`),
  ],
);

export const shopPriceVersions = pgTable('shop_price_versions', {
  shopId: uuid('shop_id')
    .primaryKey()
    .references(() => shops.id),
  version: integer('version').notNull().default(1),
  ...stamps,
});

// ---- Orders (SPEC_V3). Priced by the server; paid to the merchant at the counter ----

export const orders = pgTable(
  'orders',
  {
    id: id(),
    /** 6-char Crockford code shown to people (e.g. K7Q-2M9) */
    code: text('code').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    status: orderStatus('status').notNull().default('fee_pending'),
    feePaise: integer('fee_paise').notNull(),
    estimatedTotalPaise: integer('estimated_total_paise').notNull(),
    finalTotalPaise: integer('final_total_paise'),
    /** per shop and IST day, assigned when packed */
    packNo: integer('pack_no'),
    packDay: date('pack_day'),
    customerQrHash: text('customer_qr_hash').unique(),
    packQrHash: text('pack_qr_hash').unique(),
    packMatchedAt: tz('pack_matched_at'),
    feePaidAt: tz('fee_paid_at'),
    confirmBy: tz('confirm_by'),
    confirmedAt: tz('confirmed_at'),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    packingStartedAt: tz('packing_started_at'),
    packedAt: tz('packed_at'),
    packedBy: uuid('packed_by').references(() => users.id),
    completedAt: tz('completed_at'),
    completedBy: uuid('completed_by').references(() => users.id),
    cancelledAt: tz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    billNo: text('bill_no'),
    ...stamps,
  },
  (t) => [
    index('orders_shop_status').on(t.shopId, t.status),
    index('orders_user').on(t.userId, t.createdAt),
    uniqueIndex('orders_pack_no').on(t.shopId, t.packDay, t.packNo),
    uniqueIndex('orders_bill_no').on(t.shopId, t.billNo),
    check('orders_fee_positive', sql`${t.feePaise} > 0`),
    check('orders_totals_nonneg', sql`${t.estimatedTotalPaise} >= 0`),
  ],
);

export const orderLines = pgTable(
  'order_lines',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    /** snapshots at order time: the bill does not change if the catalogue does */
    itemNo: integer('item_no').notNull(),
    nameEn: text('name_en').notNull(),
    nameTe: text('name_te'),
    packDesc: text('pack_desc'),
    /** per pack, or per kg for weighed lines */
    unitPricePaise: integer('unit_price_paise').notNull(),
    saleUnit: saleUnit('sale_unit').notNull().default('pack'),
    /** always 1 for weighed lines */
    qty: integer('qty').notNull(),
    status: lineStatus('status').notNull().default('pending'),
    pickedQty: integer('picked_qty').notNull().default(0),
    orderedGrams: integer('ordered_grams'),
    packedGrams: integer('packed_grams'),
    proposedGrams: integer('proposed_grams'),
    /** mix box: the items the customer asked for (no quantities) */
    mixItemIds: uuid('mix_item_ids').array(),
    replacesLineId: uuid('replaces_line_id'),
    alternateItemId: uuid('alternate_item_id').references(() => items.id),
    alternateQty: integer('alternate_qty'),
    alternatePricePaise: integer('alternate_price_paise'),
    decidedAt: tz('decided_at'),
    ...stamps,
  },
  (t) => [
    uniqueIndex('order_lines_order_line_no').on(t.orderId, t.lineNo),
    check('order_lines_qty', sql`${t.qty} between 1 and 99`),
    check('order_lines_picked', sql`${t.pickedQty} between 0 and ${t.qty}`),
    check('order_lines_price', sql`${t.unitPricePaise} > 0`),
    check('order_lines_weight', sql`(${t.saleUnit} = 'pack') = (${t.orderedGrams} is null)`),
  ],
);

/** Timeline: actor, time and reason for every transition. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    actorUserId: uuid('actor_user_id'),
    type: text('type').notNull(),
    meta: jsonb('meta'),
    at: tz('at').notNull().defaultNow(),
  },
  (t) => [index('order_events_order').on(t.orderId, t.at)],
);

/** The platform's own ₹30 fee, collected through the payment adapter (G3). */
export const feePayments = pgTable(
  'fee_payments',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    provider: text('provider').notNull(),
    checkoutId: text('checkout_id').notNull(),
    checkoutUrl: text('checkout_url').notNull(),
    providerPaymentId: text('provider_payment_id'),
    status: feePaymentStatus('status').notNull().default('created'),
    amountPaise: integer('amount_paise').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    capturedAt: tz('captured_at'),
    failedAt: tz('failed_at'),
    ...stamps,
  },
  (t) => [
    uniqueIndex('fee_payments_provider_checkout').on(t.provider, t.checkoutId),
    index('fee_payments_order').on(t.orderId),
    check('fee_payments_amount', sql`${t.amountPaise} > 0`),
  ],
);

/** Every provider event once; replays hit the unique index and change nothing. */
export const feePaymentEvents = pgTable(
  'fee_payment_events',
  {
    id: id(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    payloadSha256: text('payload_sha256').notNull(),
    outcome: text('outcome').notNull(),
    receivedAt: tz('received_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('fee_payment_events_provider_event').on(t.provider, t.eventId)],
);

export const feeRefunds = pgTable(
  'fee_refunds',
  {
    id: id(),
    feePaymentId: uuid('fee_payment_id')
      .notNull()
      .references(() => feePayments.id),
    amountPaise: integer('amount_paise').notNull(),
    status: feeRefundStatus('status').notNull().default('pending'),
    providerRefundId: text('provider_refund_id'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    reason: text('reason').notNull(),
    requestedBy: uuid('requested_by').references(() => users.id),
    processedAt: tz('processed_at'),
    ...stamps,
  },
  (t) => [
    uniqueIndex('fee_refunds_one_live')
      .on(t.feePaymentId)
      .where(sql`status in ('pending','processed')`),
    check('fee_refunds_amount', sql`${t.amountPaise} > 0`),
  ],
);

/** Sale payment taken at the merchant's counter; money goes to the merchant. */
export const counterPayments = pgTable(
  'counter_payments',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    method: counterMethod('method').notNull(),
    status: counterPaymentStatus('status').notNull().default('pending'),
    amountPaise: integer('amount_paise').notNull(),
    /** YouPI payment id, card approval code, or null for cash */
    reference: text('reference'),
    /** UPI bank reference (UTR) from YouPI */
    utr: text('utr'),
    payUrl: text('pay_url'),
    receivedPaise: integer('received_paise'),
    takenBy: uuid('taken_by')
      .notNull()
      .references(() => users.id),
    receivedAt: tz('received_at'),
    ...stamps,
  },
  (t) => [
    index('counter_payments_order').on(t.orderId),
    uniqueIndex('counter_payments_one_received')
      .on(t.orderId)
      .where(sql`status = 'received'`),
    check('counter_payments_amount', sql`${t.amountPaise} > 0`),
  ],
);

/** Provider events from merchants' YouPI-PG instances, once each. */
export const counterPaymentEvents = pgTable(
  'counter_payment_events',
  {
    id: id(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    eventKey: text('event_key').notNull(),
    payloadSha256: text('payload_sha256').notNull(),
    outcome: text('outcome').notNull(),
    receivedAt: tz('received_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('counter_payment_events_key').on(t.shopId, t.eventKey)],
);

/** How a merchant takes counter payments. Set by the platform team or the owner. */
export const merchantPaymentSettings = pgTable('merchant_payment_settings', {
  shopId: uuid('shop_id')
    .primaryKey()
    .references(() => shops.id),
  youpiBaseUrl: text('youpi_base_url'),
  youpiMerchantId: text('youpi_merchant_id'),
  /** AES-256-GCM encrypted with MERCHANT_SECRETS_KEY */
  youpiWebhookSecretEnc: text('youpi_webhook_secret_enc'),
  upiVpa: text('upi_vpa'),
  acceptsCard: boolean('accepts_card').notNull().default(true),
  acceptsCash: boolean('accepts_cash').notNull().default(true),
  ...stamps,
});

/** Per-shop sequence for bill numbers. */
export const shopCounters = pgTable('shop_counters', {
  shopId: uuid('shop_id')
    .primaryKey()
    .references(() => shops.id),
  lastBillNo: integer('last_bill_no').notNull().default(0),
  ...stamps,
});

/** The merchant's own daily numbers; survives the end-of-season purge. */
export const dailyShopStats = pgTable(
  'daily_shop_stats',
  {
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    day: date('day').notNull(),
    orders: integer('orders').notNull().default(0),
    completed: integer('completed').notNull().default(0),
    cancelled: integer('cancelled').notNull().default(0),
    salesPaise: integer('sales_paise').notNull().default(0),
    ...stamps,
  },
  (t) => [primaryKey({ columns: [t.shopId, t.day] })],
);

// ---- Views ----

/** G6: shops that are live with a verified, in-date licence. Created in migration 0002. */
export const visibleShops = pgView('visible_shops', {
  id: uuid('id').notNull(),
  clusterId: uuid('cluster_id'),
  shortCode: text('short_code').notNull(),
  name: text('name').notNull(),
  area: text('area').notNull(),
  lat: numeric('lat', { precision: 9, scale: 6, mode: 'number' }),
  lng: numeric('lng', { precision: 9, scale: 6, mode: 'number' }),
  address: text('address'),
  phoneE164: text('phone_e164'),
  photoUrl: text('photo_url'),
  openFrom: time('open_from'),
  openTo: time('open_to'),
  isLive: boolean('is_live').notNull(),
}).existing();
