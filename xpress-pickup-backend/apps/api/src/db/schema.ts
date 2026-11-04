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
  DOC_STATUSES,
  FEE_PAYMENT_STATUSES,
  FEE_REFUND_STATUSES,
  GREEN_CERTS,
  ITEM_KINDS,
  KIT_TYPES,
  LICENCE_STATUSES,
  LINE_STATUSES,
  MERCHANT_DOC_TYPES,
  ONBOARDING_STATUSES,
  ORDER_STATUSES,
  ROLES,
  SALE_MODES,
  type KitContents,
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
export const saleMode = pgEnum('sale_mode', SALE_MODES);
export const merchantDocType = pgEnum('merchant_doc_type', MERCHANT_DOC_TYPES);
export const docStatus = pgEnum('doc_status', DOC_STATUSES);

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
  /** chosen app language (en, te, hi); null = not chosen yet */
  lang: text('lang'),
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
    /** agent onboarding (growth); shops set up by the platform team are 'live' from the start */
    onboardingStatus: text('onboarding_status', { enum: ONBOARDING_STATUSES })
      .notNull()
      .default('live'),
    /** the agent who set the shop up with the owner's consent; null = self-serve / platform */
    onboardedByAgentId: uuid('onboarded_by_agent_id'),
    ownerName: text('owner_name'),
    ownerPhoneE164: text('owner_phone_e164'),
    gstin: text('gstin'),
    ...stamps,
  },
  (t) => [
    check('shops_short_code_format', sql`${t.shortCode} ~ '^[A-Z0-9]{3,6}$'`),
    uniqueIndex('shops_owner_phone_open')
      .on(t.ownerPhoneE164)
      .where(sql`${t.onboardingStatus} <> 'closed'`),
  ],
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

// ---- Merchant documents (fire, police, government authority, GST, business registration) ----

export const shopDocuments = pgTable(
  'shop_documents',
  {
    id: id(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    docType: merchantDocType('doc_type').notNull(),
    docNumber: text('doc_number').notNull(),
    issuedBy: text('issued_by'),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    /** in the PRIVATE licences store; read back only through the owner and admin APIs */
    filePath: text('file_path').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    status: docStatus('status').notNull().default('pending'),
    notes: text('notes'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    verifiedBy: uuid('verified_by').references(() => users.id),
    verifiedAt: tz('verified_at'),
    /** set when a newer upload of the same type replaces this one (kept for the record) */
    supersededAt: tz('superseded_at'),
    ...stamps,
  },
  (t) => [
    uniqueIndex('shop_documents_one_current')
      .on(t.shopId, t.docType)
      .where(sql`${t.supersededAt} is null`),
    index('shop_documents_status_idx')
      .on(t.status, t.createdAt)
      .where(sql`${t.supersededAt} is null`),
    check(
      'shop_documents_dates',
      sql`${t.validFrom} is null or ${t.validTo} is null or ${t.validFrom} <= ${t.validTo}`,
    ),
    check('shop_documents_size', sql`${t.sizeBytes} > 0`),
    check(
      'shop_documents_rejected_reason',
      sql`${t.status} <> 'rejected' or length(trim(coalesce(${t.notes}, ''))) >= 3`,
    ),
  ],
);

// ---- Catalogue ----

export const categories = pgTable('categories', {
  id: id(),
  slug: text('slug').notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameTe: text('name_te'),
  nameHi: text('name_hi'),
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
    nameHi: text('name_hi'),
    packDesc: text('pack_desc'),
    pricePaise: integer('price_paise').notNull(),
    /** shop price version at the last price change; counters flag lists older than this */
    priceVersion: integer('price_version').notNull().default(1),
    /** optional (G7, amended): products with a green certificate show it */
    greenCert: greenCertType('green_cert'),
    greenRef: text('green_ref'),
    rackCode: text('rack_code'),
    imageUrl: text('image_url'),
    /** product photo in the shop-media store (served by /api/media) */
    imagePath: text('image_path'),
    /** second photo, the box open (every product needs both; agent go-live checks it) */
    imageOpenPath: text('image_open_path'),
    barcode: text('barcode'),
    /** null = stock not tracked */
    stockQty: integer('stock_qty'),
    offerPricePaise: integer('offer_price_paise'),
    offerEndsAt: tz('offer_ends_at'),
    isSoldOut: boolean('is_sold_out').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    /** set when the owner removes the product; the row stays for order history */
    removedAt: tz('removed_at'),
    /** owner-set: first under the customer's Recommended / Popular sorts */
    isRecommended: boolean('is_recommended').notNull().default(false),
    /** "Popular / Trending" */
    isPopular: boolean('is_popular').notNull().default(false),
    /** Standard product (Standard Fireworks / certified standard brand) */
    isStandard: boolean('is_standard').notNull().default(false),
    /** kilo pack: fixed net weight of one pack; null = sold by count */
    weightGrams: integer('weight_grams'),
    /** mrp = normal / pack sale, kilo = by weight; price_paise is always the price of one pack */
    saleMode: saleMode('sale_mode').notNull().default('mrp'),
    /** 'store' = generated in-store EAN-13 (label printed by the shop), 'box' = printed on the box */
    barcodeSource: text('barcode_source', { enum: ['store', 'box'] })
      .notNull()
      .default('box'),
    /** kilo sale: the owner's rate per kg (price_paise is derived from it and the weight) */
    pricePerKgPaise: integer('price_per_kg_paise'),
    offerPricePerKgPaise: integer('offer_price_per_kg_paise'),
    /** a kit (one of the five standard types) is one product, scanned once */
    kind: text('kind', { enum: ITEM_KINDS }).notNull().default('product'),
    kitType: text('kit_type', { enum: KIT_TYPES }),
    contents: jsonb('contents').$type<KitContents>(),
    ...stamps,
  },
  (t) => [
    check(
      'items_sale_mode_fields',
      sql`(${t.saleMode} = 'mrp' and ${t.weightGrams} is null and ${t.pricePerKgPaise} is null and ${t.offerPricePerKgPaise} is null) or (${t.saleMode} = 'kilo' and ${t.weightGrams} is not null and ${t.pricePerKgPaise} > 0 and (${t.offerPricePerKgPaise} is null or (${t.offerPricePerKgPaise} > 0 and ${t.offerPricePerKgPaise} < ${t.pricePerKgPaise})))`,
    ),
    check('items_barcode_present', sql`${t.removedAt} is not null or ${t.barcode} is not null`),
    check('items_barcode_source', sql`${t.barcodeSource} in ('store', 'box')`),
    uniqueIndex('items_shop_item_no').on(t.shopId, t.itemNo),
    check('items_weight_positive', sql`${t.weightGrams} is null or ${t.weightGrams} > 0`),
    uniqueIndex('items_shop_barcode').on(t.shopId, t.barcode),
    check('items_stock_nonneg', sql`${t.stockQty} is null or ${t.stockQty} >= 0`),
    check(
      'items_offer_lower',
      sql`${t.offerPricePaise} is null or (${t.offerPricePaise} > 0 and ${t.offerPricePaise} < ${t.pricePaise})`,
    ),
    check('items_price_positive', sql`${t.pricePaise} > 0`),
    check('items_item_no_positive', sql`${t.itemNo} > 0`),
    check(
      'items_green_ref_present',
      sql`${t.greenRef} is null or length(trim(${t.greenRef})) >= 2`,
    ),
    check(
      'items_kit_fields',
      sql`(${t.kind} = 'product' and ${t.kitType} is null and ${t.contents} is null) or (${t.kind} = 'kit' and ${t.kitType} is not null and ${t.contents} is not null)`,
    ),
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
    /** the pack sticker QR as printed; the customer is shown this same QR */
    packQr: text('pack_qr'),
    packMatchedAt: tz('pack_matched_at'),
    feePaidAt: tz('fee_paid_at'),
    /** GST tax invoice for the platform fee, XPF/<FY>/<serial>, set when the fee is paid */
    feeInvoiceNo: text('fee_invoice_no').unique(),
    confirmBy: tz('confirm_by'),
    confirmedAt: tz('confirmed_at'),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    packingStartedAt: tz('packing_started_at'),
    packedAt: tz('packed_at'),
    packedBy: uuid('packed_by').references(() => users.id),
    /** photo of the packed order with its sticker, in the private order-photos store */
    packPhotoPath: text('pack_photo_path'),
    packPhotoAt: tz('pack_photo_at'),
    packPhotoBy: uuid('pack_photo_by').references(() => users.id),
    completedAt: tz('completed_at'),
    completedBy: uuid('completed_by').references(() => users.id),
    cancelledAt: tz('cancelled_at'),
    cancelReason: text('cancel_reason'),
    billNo: text('bill_no'),
    arrivalStatus: text('arrival_status').notNull().default('not_arrived'),
    arrivalNotifiedAt: tz('arrival_notified_at'),
    assistanceType: text('assistance_type'),
    assistanceNotes: text('assistance_notes'),
    assistanceStatus: text('assistance_status').notNull().default('none'),
    assistanceRequestedAt: tz('assistance_requested_at'),
    assistanceReviewedAt: tz('assistance_reviewed_at'),
    assistanceReviewedBy: uuid('assistance_reviewed_by').references(() => users.id),
    gateNotificationStatus: text('gate_notification_status').notNull().default('none'),
    gateAcknowledgedAt: tz('gate_acknowledged_at'),
    gateAcknowledgedBy: uuid('gate_acknowledged_by').references(() => users.id),
    ...stamps,
  },
  (t) => [
    index('orders_shop_status').on(t.shopId, t.status),
    index('orders_shop_assistance').on(t.shopId, t.assistanceStatus),
    index('orders_gate_notif').on(t.gateNotificationStatus),
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
    nameHi: text('name_hi'),
    packDesc: text('pack_desc'),
    unitPricePaise: integer('unit_price_paise').notNull(),
    qty: integer('qty').notNull(),
    status: lineStatus('status').notNull().default('pending'),
    pickedQty: integer('picked_qty').notNull().default(0),
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
    verificationSource: text('verification_source').default('manual'),
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
  qrImagePath: text('qr_image_path'),
  qrUploadedBy: uuid('qr_uploaded_by').references(() => users.id),
  qrUploadedAt: tz('qr_uploaded_at'),
  qrActive: boolean('qr_active').notNull().default(true),
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

// ---- Growth program: agents (gig workers), merchant subscriptions, payouts ----
// Money rows are append-only and idempotent (G13): one payout per shop, moved only forward by
// compare-and-set (pending → sent, or failed → pending on retry, or reversed).

export const agents = pgTable(
  'agents',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id),
    /** DXA- plus 6 Crockford characters, permanent */
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    /** induction finished before registering (version and time) */
    inductionVersion: text('induction_version'),
    inductionCompletedAt: tz('induction_completed_at'),
    status: text('status', { enum: ['pending', 'active', 'suspended'] })
      .notNull()
      .default('pending'),
    /** payouts go here: encrypted, a hash for "one agent per UPI ID", and a hint (G9) */
    upiEnc: text('upi_enc').notNull(),
    upiHash: text('upi_hash').notNull().unique(),
    upiHint: text('upi_hint').notNull(),
    panEnc: text('pan_enc'),
    panLast4: text('pan_last4'),
    agreementVersion: text('agreement_version').notNull(),
    agreementAcceptedAt: tz('agreement_accepted_at').notNull(),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: tz('approved_at'),
    suspendedReason: text('suspended_reason'),
    lang: text('lang'),
    ...stamps,
  },
  (t) => [check('agents_code_format', sql`${t.code} ~ '^DXA-[0-9A-HJKMNP-TV-Z]{6}$'`)],
);

export const shopEvents = pgTable(
  'shop_events',
  {
    id: id(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    type: text('type').notNull(),
    meta: jsonb('meta'),
    at: tz('at').notNull().defaultNow(),
  },
  (t) => [index('shop_events_shop').on(t.shopId, t.at)],
);

/** Owner links: the consent OTP / approve link, and the review-and-pay link. Tokens hashed. */
export const ownerLinks = pgTable(
  'owner_links',
  {
    id: id(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    purpose: text('purpose', { enum: ['consent', 'review'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    codeHash: text('code_hash'),
    attempts: integer('attempts').notNull().default(0),
    lockedUntil: tz('locked_until'),
    expiresAt: tz('expires_at').notNull(),
    usedAt: tz('used_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('owner_links_shop').on(t.shopId, t.purpose)],
);

/** Proof the owner agreed to an agent setting up the shop. First consent wins. */
export const shopConsents = pgTable('shop_consents', {
  id: id(),
  shopId: uuid('shop_id')
    .notNull()
    .unique()
    .references(() => shops.id),
  agentId: uuid('agent_id').references(() => agents.id),
  method: text('method', { enum: ['otp', 'link'] }).notNull(),
  device: text('device'),
  at: tz('at').notNull().defaultNow(),
});

export const merchantSubscriptions = pgTable(
  'merchant_subscriptions',
  {
    id: id(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    season: text('season').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    gstPaise: integer('gst_paise').notNull(),
    status: text('status', { enum: ['pending', 'paid', 'refunded', 'cancelled'] })
      .notNull()
      .default('pending'),
    method: text('method', { enum: ['online', 'offline'] }).notNull(),
    provider: text('provider'),
    checkoutId: text('checkout_id'),
    checkoutUrl: text('checkout_url'),
    providerPaymentId: text('provider_payment_id'),
    offlineReference: text('offline_reference'),
    markedBy: uuid('marked_by').references(() => users.id),
    invoiceNo: text('invoice_no').unique(),
    paidAt: tz('paid_at'),
    ...stamps,
  },
  (t) => [
    uniqueIndex('merchant_subscriptions_checkout').on(t.provider, t.checkoutId),
    uniqueIndex('merchant_subscriptions_one_paid')
      .on(t.shopId, t.season)
      .where(sql`${t.status} = 'paid'`),
  ],
);

/** ₹1,000 per live shop, paid straight to the agent's UPI ID by an admin (UTR recorded). */
export const agentPayouts = pgTable(
  'agent_payouts',
  {
    id: id(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    shopId: uuid('shop_id')
      .notNull()
      .unique()
      .references(() => shops.id),
    amountPaise: integer('amount_paise').notNull(),
    /** Indian financial year the payout was earned in, e.g. 2026-27 (TDS and the PAN gate) */
    fy: text('fy').notNull(),
    tdsPaise: integer('tds_paise').notNull().default(0),
    /** part of the year's earnings above the TDS threshold this payout taxed */
    tdsBasePaise: integer('tds_base_paise').notNull().default(0),
    status: text('status', { enum: ['pending', 'sent', 'failed', 'reversed'] })
      .notNull()
      .default('pending'),
    utr: text('utr'),
    sentAt: tz('sent_at'),
    decidedBy: uuid('decided_by').references(() => users.id),
    failureReason: text('failure_reason'),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    reversalReason: text('reversal_reason'),
    earnedAt: tz('earned_at').notNull().defaultNow(),
    reversedAt: tz('reversed_at'),
  },
  (t) => [
    uniqueIndex('agent_payouts_once').on(t.agentId, t.shopId),
    index('agent_payouts_agent_fy').on(t.agentId, t.fy),
    index('agent_payouts_status_idx').on(t.status, t.earnedAt),
  ],
);

export const agentFeedback = pgTable(
  'agent_feedback',
  {
    id: id(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    helped: boolean('helped').notNull(),
    note: text('note'),
    at: tz('at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('agent_feedback_once').on(t.agentId, t.shopId)],
);

export const termsAcceptances = pgTable(
  'terms_acceptances',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    party: text('party').notNull(),
    version: text('version').notNull(),
    acceptedAt: tz('accepted_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.party, t.version] })],
);

/** In-app notices (agents: each onboarding step and payout; owners: the review link). */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    params: jsonb('params'),
    readAt: tz('read_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('notifications_user').on(t.userId, t.createdAt)],
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

// ---- Web push (SPEC_V3 §11) ----

/** A browser's push subscription for one installed app. Removed on sign-out, delete-me and purge. */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    app: text('app').notNull(),
    lang: text('lang').notNull().default('en'),
    lastSentAt: tz('last_sent_at'),
    ...stamps,
  },
  (t) => [
    index('push_subscriptions_user').on(t.userId),
    check('push_subscriptions_app', sql`${t.app} in ('customer', 'merchant')`),
  ],
);

/**
 * Notifications written in the same transaction as the order change, so a
 * rolled-back change never notifies. Sent right after the request, and by the
 * minute timer if that fails.
 */
export const pushOutbox = pgTable(
  'push_outbox',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    app: text('app').notNull(),
    kind: text('kind').notNull(),
    url: text('url').notNull(),
    params: jsonb('params').notNull().default({}),
    attempts: integer('attempts').notNull().default(0),
    sentAt: tz('sent_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('push_outbox_pending')
      .on(t.createdAt)
      .where(sql`${t.sentAt} is null`),
  ],
);
