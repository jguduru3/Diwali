import { z } from 'zod';
import { phoneSchema } from './schemas';

// ---- Enums (SPEC §6.1) ----

/** CSIR-NEERI green-cracker labels. Confirm current names with partner shops (SPEC §17). */
export const GREEN_CERTS = [
  'CSIR_NEERI_SWAS',
  'CSIR_NEERI_STAR',
  'CSIR_NEERI_SAFAL',
  'CSIR_NEERI_OTHER',
] as const;
export const LICENCE_STATUSES = ['pending', 'verified', 'rejected', 'expired'] as const;
export const VISIT_STATUSES = ['booked', 'arrived', 'served', 'no_show', 'cancelled'] as const;
export const VEHICLES = ['car', 'bike', 'walk'] as const;

export const greenCertSchema = z.enum(GREEN_CERTS);
export const licenceStatusSchema = z.enum(LICENCE_STATUSES);
export const visitStatusSchema = z.enum(VISIT_STATUSES);
export const vehicleSchema = z.enum(VEHICLES);
export type GreenCert = z.infer<typeof greenCertSchema>;
export type LicenceStatus = z.infer<typeof licenceStatusSchema>;
export type VisitStatus = z.infer<typeof visitStatusSchema>;
export type Vehicle = z.infer<typeof vehicleSchema>;

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const shopCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,6}$/, 'Shop code: 3–6 letters or digits');
export const visitCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-HJKMNP-TV-Z]{6}$/, 'Visit code: 6 characters');
const iso = z.string();

// ---- Public: places, catalogue, slots ----

export const areaSchema = z.object({
  area: z.string(),
  lat: z.number(),
  lng: z.number(),
  shopCount: z.number(),
});
export type AreaSummary = z.infer<typeof areaSchema>;

export const licenceBadgeSchema = z.object({
  licenceNo: z.string(),
  licenceType: z.string(),
  validTo: dateSchema,
});

export const slotSchema = z.object({
  id: z.string().uuid(),
  startsAt: iso,
  endsAt: iso,
  capacity: z.number(),
  booked: z.number(),
  remaining: z.number(),
  /** false when full or starting in less than 30 minutes */
  bookable: z.boolean(),
});
export type Slot = z.infer<typeof slotSchema>;

export const clusterInfoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  area: z.string(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  gateNotes: z.string().nullable(),
});
export type ClusterInfo = z.infer<typeof clusterInfoSchema>;

export const shopSummarySchema = z.object({
  shortCode: z.string(),
  name: z.string(),
  area: z.string(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  photoUrl: z.string().nullable(),
  openFrom: z.string().nullable(),
  openTo: z.string().nullable(),
  openNow: z.boolean(),
  distanceKm: z.number().nullable(),
  licence: licenceBadgeSchema,
  cluster: clusterInfoSchema.nullable(),
  nextFreeSlot: slotSchema.nullable(),
});
export type ShopSummary = z.infer<typeof shopSummarySchema>;

export const shopDetailSchema = shopSummarySchema.extend({
  phone: z.string().nullable(),
  priceVersion: z.number(),
  slotMinutes: z.number(),
});
export type ShopDetail = z.infer<typeof shopDetailSchema>;

export const categorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  nameEn: z.string(),
  nameTe: z.string().nullable(),
  sort: z.number(),
  isBanned: z.boolean(),
  bannedReason: z.string().nullable(),
});
export type Category = z.infer<typeof categorySchema>;

export const itemSchema = z.object({
  id: z.string().uuid(),
  itemNo: z.number(),
  categoryId: z.string().uuid(),
  nameEn: z.string(),
  nameTe: z.string().nullable(),
  packDesc: z.string().nullable(),
  pricePaise: z.number(),
  /** shop price version when this price last changed */
  priceVersion: z.number(),
  greenCert: greenCertSchema,
  greenRef: z.string(),
  rackCode: z.string().nullable(),
  imageUrl: z.string().nullable(),
  isSoldOut: z.boolean(),
  isActive: z.boolean(),
});
export type Item = z.infer<typeof itemSchema>;

export const itemsResponseSchema = z.object({
  shopCode: z.string(),
  priceVersion: z.number(),
  categories: z.array(categorySchema),
  items: z.array(itemSchema),
});
export type ItemsResponse = z.infer<typeof itemsResponseSchema>;

// ---- Visits (queue tokens: no items, no amounts — G1, G4) ----

export const createVisitSchema = z
  .object({
    shopShortCode: shopCodeSchema,
    slotId: z.string().uuid(),
    vehicle: vehicleSchema.optional(),
  })
  .strict();
export type CreateVisit = z.input<typeof createVisitSchema>;

export const visitSchema = z.object({
  code: z.string(),
  status: visitStatusSchema,
  vehicle: vehicleSchema.nullable(),
  bayNo: z.number().nullable(),
  slot: z.object({ startsAt: iso, endsAt: iso }),
  shop: z.object({
    shortCode: z.string(),
    name: z.string(),
    address: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
  }),
  cluster: clusterInfoSchema.nullable(),
  arrivedAt: iso.nullable(),
  servedAt: iso.nullable(),
  createdAt: iso,
});
export type Visit = z.infer<typeof visitSchema>;

export const currentVisitResponseSchema = z.object({ visit: visitSchema.nullable() });

// ---- Gate ----

export const gateCheckinSchema = z
  .object({
    code: visitCodeSchema,
    bayNo: z.number().int().min(1).max(500).optional(),
  })
  .strict();
export type GateCheckin = z.input<typeof gateCheckinSchema>;

export const gateCheckinResultSchema = z.object({
  code: z.string(),
  bayNo: z.number(),
  shop: z.object({ shortCode: z.string(), name: z.string() }),
  slot: z.object({ startsAt: iso, endsAt: iso }),
  vehicle: vehicleSchema.nullable(),
});
export type GateCheckinResult = z.infer<typeof gateCheckinResultSchema>;

export const queueVisitSchema = z.object({
  code: z.string(),
  status: visitStatusSchema,
  vehicle: vehicleSchema.nullable(),
  bayNo: z.number().nullable(),
  shopCode: z.string(),
  shopName: z.string(),
  slotStartsAt: iso,
  slotEndsAt: iso,
  arrivedAt: iso.nullable(),
  servedAt: iso.nullable(),
});
export type QueueVisit = z.infer<typeof queueVisitSchema>;

export const gateTodaySchema = z.object({
  cluster: clusterInfoSchema.extend({ bayCount: z.number() }),
  baysInUse: z.array(z.object({ bayNo: z.number(), code: z.string(), shopName: z.string() })),
  visits: z.array(queueVisitSchema),
});
export type GateToday = z.infer<typeof gateTodaySchema>;

// ---- Shop app ----

export const shopContextSchema = z.object({
  shopCode: z.string(),
  name: z.string(),
  area: z.string(),
  isLive: z.boolean(),
  visible: z.boolean(),
  openFrom: z.string().nullable(),
  openTo: z.string().nullable(),
  slotMinutes: z.number(),
  defaultCapacityPerSlot: z.number(),
  priceVersion: z.number(),
  canEdit: z.boolean(),
  cluster: clusterInfoSchema.nullable(),
});
export type ShopContext = z.infer<typeof shopContextSchema>;

export const itemInputSchema = z
  .object({
    categoryId: z.string().uuid(),
    nameEn: z.string().trim().min(2).max(80),
    nameTe: z.string().trim().max(80).optional(),
    packDesc: z.string().trim().max(40).optional(),
    pricePaise: z.number().int().positive().max(10_000_000),
    greenCert: greenCertSchema,
    greenRef: z.string().trim().min(2, 'Green certificate reference is required').max(60),
    rackCode: z.string().trim().max(10).optional(),
    isSoldOut: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type ItemInput = z.input<typeof itemInputSchema>;
export const itemPatchSchema = itemInputSchema.partial().strict();
export type ItemPatch = z.input<typeof itemPatchSchema>;
export const soldOutSchema = z.object({ isSoldOut: z.boolean() }).strict();

export const shopSettingsSchema = z
  .object({
    openFrom: timeSchema,
    openTo: timeSchema,
    defaultCapacityPerSlot: z.number().int().min(1).max(200),
  })
  .strict();
export type ShopSettings = z.input<typeof shopSettingsSchema>;

export const daySlotsSchema = z
  .object({
    date: dateSchema,
    openFrom: timeSchema,
    openTo: timeSchema,
    capacity: z.number().int().min(1).max(200),
  })
  .strict();
export type DaySlots = z.input<typeof daySlotsSchema>;

export const slotCapacitySchema = z.object({ capacity: z.number().int().min(0).max(200) }).strict();

export const shopTodaySchema = z.object({
  date: dateSchema,
  slots: z.array(slotSchema.extend({ visits: z.array(queueVisitSchema) })),
});
export type ShopToday = z.infer<typeof shopTodaySchema>;

export const footfallRowSchema = z.object({
  day: dateSchema,
  booked: z.number(),
  arrived: z.number(),
  served: z.number(),
  noShow: z.number(),
  cancelled: z.number(),
});
export type FootfallRow = z.infer<typeof footfallRowSchema>;

export const licenceSchema = z.object({
  id: z.string().uuid(),
  shopCode: z.string(),
  shopName: z.string(),
  licenceNo: z.string(),
  licenceType: z.string(),
  issuedBy: z.string().nullable(),
  validFrom: dateSchema.nullable(),
  validTo: dateSchema,
  status: licenceStatusSchema,
  notes: z.string().nullable(),
  verifiedAt: iso.nullable(),
  createdAt: iso,
  hasImage: z.boolean(),
});
export type Licence = z.infer<typeof licenceSchema>;

export const LICENCE_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const licenceSubmitSchema = z
  .object({
    licenceNo: z.string().trim().min(3).max(60),
    licenceType: z.string().trim().min(2).max(40),
    issuedBy: z.string().trim().max(80).optional(),
    validFrom: dateSchema,
    validTo: dateSchema,
    image: z.object({
      contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      base64: z
        .string()
        .min(100)
        .max(Math.ceil((LICENCE_IMAGE_MAX_BYTES * 4) / 3) + 8),
    }),
  })
  .strict()
  .refine((v) => v.validFrom <= v.validTo, { message: 'Valid-from must be before valid-to' });
export type LicenceSubmit = z.input<typeof licenceSubmitSchema>;

// ---- Admin ----

export const clusterInputSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    area: z.string().trim().min(2).max(60),
    address: z.string().trim().max(200).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    bayCount: z.number().int().min(1).max(500).optional(),
    gateNotes: z.string().trim().max(300).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type ClusterInput = z.input<typeof clusterInputSchema>;
export const clusterPatchSchema = clusterInputSchema.partial().strict();

export const adminClusterSchema = clusterInfoSchema.extend({
  bayCount: z.number(),
  isActive: z.boolean(),
  shopCount: z.number(),
});
export type AdminCluster = z.infer<typeof adminClusterSchema>;

export const shopInputSchema = z
  .object({
    shortCode: shopCodeSchema,
    name: z.string().trim().min(2).max(80),
    area: z.string().trim().min(2).max(60),
    clusterId: z.string().uuid().nullable().optional(),
    address: z.string().trim().max(200).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    phone: phoneSchema.optional(),
    openFrom: timeSchema.optional(),
    openTo: timeSchema.optional(),
    defaultCapacityPerSlot: z.number().int().min(1).max(200).optional(),
    isLive: z.boolean().optional(),
  })
  .strict();
export type ShopInput = z.input<typeof shopInputSchema>;
export const shopPatchSchema = shopInputSchema.omit({ shortCode: true }).partial().strict();
export type ShopPatch = z.input<typeof shopPatchSchema>;

export const adminShopSchema = z.object({
  id: z.string().uuid(),
  shortCode: z.string(),
  name: z.string(),
  area: z.string(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  phone: z.string().nullable(),
  clusterId: z.string().uuid().nullable(),
  clusterName: z.string().nullable(),
  openFrom: z.string().nullable(),
  openTo: z.string().nullable(),
  defaultCapacityPerSlot: z.number(),
  isLive: z.boolean(),
  visible: z.boolean(),
  licenceStatus: licenceStatusSchema.nullable(),
  licenceValidFrom: dateSchema.nullable(),
  licenceValidTo: dateSchema.nullable(),
  itemCount: z.number(),
});
export type AdminShop = z.infer<typeof adminShopSchema>;

export const categoryInputSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{2,40}$/),
    nameEn: z.string().trim().min(2).max(60),
    nameTe: z.string().trim().max(60).optional(),
    sort: z.number().int().min(0).max(1000).optional(),
    isBanned: z.boolean().optional(),
    bannedReason: z.string().trim().max(200).optional(),
  })
  .strict();
export type CategoryInput = z.input<typeof categoryInputSchema>;
export const categoryPatchSchema = categoryInputSchema.omit({ slug: true }).partial().strict();

export const licenceDecisionSchema = z
  .object({ notes: z.string().trim().max(300).optional() })
  .strict();

export const blockedUserSchema = z.object({
  userId: z.string().uuid(),
  phone: z.string(),
  noShowStrikes: z.number(),
  blockedUntil: iso.nullable(),
});
export type BlockedUser = z.infer<typeof blockedUserSchema>;

export const metricsRowSchema = z.object({
  shopCode: z.string(),
  shopName: z.string(),
  day: dateSchema,
  booked: z.number(),
  arrived: z.number(),
  served: z.number(),
  noShow: z.number(),
  cancelled: z.number(),
  noShowRate: z.number().nullable(),
  medianArriveToServeMin: z.number().nullable(),
});
export type MetricsRow = z.infer<typeof metricsRowSchema>;

// ---- Demo mode ----

export const demoAccountSchema = z.object({
  phone: z.string(),
  displayName: z.string().nullable(),
  role: z.string(),
  context: z.string().nullable(),
});
export type DemoAccount = z.infer<typeof demoAccountSchema>;
export const demoInfoSchema = z.object({
  enabled: z.boolean(),
  accounts: z.array(demoAccountSchema),
});
export type DemoInfo = z.infer<typeof demoInfoSchema>;
export const demoLoginSchema = z.object({ phone: phoneSchema }).strict();
