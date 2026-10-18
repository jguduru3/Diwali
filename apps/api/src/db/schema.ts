// Data model (SPEC §6, SPEC_V2 §6). Never add item lists, quantities or sale
// amounts anywhere (G1, G4). The only money stored is the flat pass fee.
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
  GREEN_CERTS,
  LICENCE_STATUSES,
  PASS_STATUSES,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  ROLES,
  SCAN_FLAGS,
  SCAN_RESULTS,
} from '@pataka/shared';

export const userRole = pgEnum('user_role', ROLES);
export const licenceStatus = pgEnum('licence_status', LICENCE_STATUSES);
export const greenCertType = pgEnum('green_cert_type', GREEN_CERTS);
export const passStatus = pgEnum('pass_status', PASS_STATUSES);
export const paymentStatus = pgEnum('payment_status', PAYMENT_STATUSES);
export const refundStatus = pgEnum('refund_status', REFUND_STATUSES);
export const scanResult = pgEnum('scan_result', SCAN_RESULTS);
export const scanFlag = pgEnum('scan_flag', SCAN_FLAGS);

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
    check('shop_members_role', sql`${t.role} in ('shop_owner','shop_staff')`),
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

// ---- Catalogue (price list only — NOT an order system) ----

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
    pricePaise: integer('price_paise').notNull(),
    /** shop price version at the last price change; counters flag lists older than this */
    priceVersion: integer('price_version').notNull().default(1),
    greenCert: greenCertType('green_cert').notNull(),
    greenRef: text('green_ref').notNull(),
    rackCode: text('rack_code'),
    imageUrl: text('image_url'),
    isSoldOut: boolean('is_sold_out').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...stamps,
  },
  (t) => [
    uniqueIndex('items_shop_item_no').on(t.shopId, t.itemNo),
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

// ---- Express Pass (SPEC_V2 §4–6) ----

/** One flat-fee pass per customer. Only a hash of the QR secret is stored. */
export const passes = pgTable(
  'passes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** public reference shown to people, e.g. DXP-K7Q2-M9AB */
    ref: text('ref').notNull().unique(),
    status: passStatus('status').notNull().default('pending_payment'),
    /** sha256 hex of the current QR secret; null until first shown */
    secretHash: text('secret_hash').unique(),
    secretRotatedAt: tz('secret_rotated_at'),
    feePaise: integer('fee_paise').notNull(),
    paidAt: tz('paid_at'),
    validFrom: tz('valid_from'),
    validTo: tz('valid_to'),
    revokedAt: tz('revoked_at'),
    revokedBy: uuid('revoked_by').references(() => users.id),
    revokeReason: text('revoke_reason'),
    ...stamps,
  },
  (t) => [
    uniqueIndex('one_open_pass')
      .on(t.userId)
      .where(sql`status in ('pending_payment','active')`),
    check('passes_fee_positive', sql`${t.feePaise} > 0`),
  ],
);

/** A payment attempt for a pass with the provider. */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    passId: uuid('pass_id')
      .notNull()
      .references(() => passes.id),
    provider: text('provider').notNull(),
    /** provider's order / checkout id */
    checkoutId: text('checkout_id').notNull(),
    checkoutUrl: text('checkout_url').notNull(),
    providerPaymentId: text('provider_payment_id'),
    status: paymentStatus('status').notNull().default('created'),
    amountPaise: integer('amount_paise').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    capturedAt: tz('captured_at'),
    failedAt: tz('failed_at'),
    ...stamps,
  },
  (t) => [
    uniqueIndex('payments_provider_checkout').on(t.provider, t.checkoutId),
    index('payments_pass_idx').on(t.passId),
    check('payments_amount_positive', sql`${t.amountPaise} > 0`),
  ],
);

/** Every provider event, once. Replays hit the unique index and are ignored. */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: id(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    payloadSha256: text('payload_sha256').notNull(),
    outcome: text('outcome').notNull(),
    receivedAt: tz('received_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payment_events_provider_event').on(t.provider, t.eventId)],
);

export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    amountPaise: integer('amount_paise').notNull(),
    status: refundStatus('status').notNull().default('pending'),
    providerRefundId: text('provider_refund_id'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    reason: text('reason').notNull(),
    requestedBy: uuid('requested_by').references(() => users.id),
    processedAt: tz('processed_at'),
    ...stamps,
  },
  (t) => [
    // At most one refund per payment that has not failed.
    uniqueIndex('one_live_refund')
      .on(t.paymentId)
      .where(sql`status in ('pending','processed')`),
    check('refunds_amount_positive', sql`${t.amountPaise} > 0`),
  ],
);

/** Every verification attempt at a shop counter or a ground gate. No money (G4). */
export const passScans = pgTable(
  'pass_scans',
  {
    id: id(),
    passId: uuid('pass_id').references(() => passes.id),
    shopId: uuid('shop_id').references(() => shops.id),
    clusterId: uuid('cluster_id').references(() => clusters.id),
    scannedBy: uuid('scanned_by')
      .notNull()
      .references(() => users.id),
    result: scanResult('result').notNull(),
    flag: scanFlag('flag'),
    at: tz('at').notNull().defaultNow(),
  },
  (t) => [
    index('pass_scans_pass_at').on(t.passId, t.at),
    index('pass_scans_shop_at').on(t.shopId, t.at),
    index('pass_scans_cluster_at').on(t.clusterId, t.at),
    check('pass_scans_one_place', sql`(${t.shopId} is not null) <> (${t.clusterId} is not null)`),
  ],
);

/** Daily verification counts per shop; survives the end-of-season scan purge. */
export const dailyShopStats = pgTable(
  'daily_shop_stats',
  {
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    day: date('day').notNull(),
    scans: integer('scans').notNull().default(0),
    uniquePasses: integer('unique_passes').notNull().default(0),
    flagged: integer('flagged').notNull().default(0),
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
