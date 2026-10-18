// Data model (SPEC §6). Visits are queue tokens only: never add item lists,
// quantities or money columns to visits (G1, G4).
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
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
import { GREEN_CERTS, LICENCE_STATUSES, ROLES, VISIT_STATUSES } from '@pataka/shared';

export const userRole = pgEnum('user_role', ROLES);
export const licenceStatus = pgEnum('licence_status', LICENCE_STATUSES);
export const greenCertType = pgEnum('green_cert_type', GREEN_CERTS);
export const visitStatus = pgEnum('visit_status', VISIT_STATUSES);

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
  noShowStrikes: integer('no_show_strikes').notNull().default(0),
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
  bayCount: integer('bay_count').notNull().default(20),
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
    slotMinutes: integer('slot_minutes').notNull().default(30),
    defaultCapacityPerSlot: integer('default_capacity_per_slot').notNull().default(10),
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

// ---- Slots and visits (queue tokens — no items, no amounts) ----

export const slots = pgTable(
  'slots',
  {
    id: id(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    startsAt: tz('starts_at').notNull(),
    endsAt: tz('ends_at').notNull(),
    capacity: integer('capacity').notNull(),
    booked: integer('booked').notNull().default(0),
    ...stamps,
  },
  (t) => [
    uniqueIndex('slots_shop_starts').on(t.shopId, t.startsAt),
    check('slots_booked_le_capacity', sql`${t.booked} <= ${t.capacity}`),
    check('slots_booked_nonneg', sql`${t.booked} >= 0`),
  ],
);

export const visits = pgTable(
  'visits',
  {
    id: id(),
    code: char('code', { length: 6 }).notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => slots.id),
    status: visitStatus('status').notNull().default('booked'),
    partyVehicle: text('party_vehicle'),
    bayNo: integer('bay_no'),
    arrivedAt: tz('arrived_at'),
    servedAt: tz('served_at'),
    cancelledAt: tz('cancelled_at'),
    noShowAt: tz('no_show_at'),
    ...stamps,
  },
  (t) => [
    uniqueIndex('one_active_visit')
      .on(t.userId)
      .where(sql`status in ('booked','arrived')`),
    index('visits_slot_idx').on(t.slotId),
    index('visits_shop_idx').on(t.shopId),
  ],
);

export const dailyShopStats = pgTable(
  'daily_shop_stats',
  {
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id),
    day: date('day').notNull(),
    booked: integer('booked').notNull().default(0),
    arrived: integer('arrived').notNull().default(0),
    served: integer('served').notNull().default(0),
    noShow: integer('no_show').notNull().default(0),
    cancelled: integer('cancelled').notNull().default(0),
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
  slotMinutes: integer('slot_minutes').notNull(),
  defaultCapacityPerSlot: integer('default_capacity_per_slot').notNull(),
  isLive: boolean('is_live').notNull(),
}).existing();
