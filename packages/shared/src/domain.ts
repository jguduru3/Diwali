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

export const greenCertSchema = z.enum(GREEN_CERTS);
export const licenceStatusSchema = z.enum(LICENCE_STATUSES);
export type GreenCert = z.infer<typeof greenCertSchema>;
export type LicenceStatus = z.infer<typeof licenceStatusSchema>;

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const shopCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,6}$/, 'Shop code: 3–6 letters or digits');
const iso = z.string();

// ---- Public: places, catalogue ----

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
});
export type ShopSummary = z.infer<typeof shopSummarySchema>;

export const shopDetailSchema = shopSummarySchema.extend({
  phone: z.string().nullable(),
  priceVersion: z.number(),
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
  barcode: z.string().nullable(),
  /** null = stock not tracked */
  stockQty: z.number().nullable(),
  offerPricePaise: z.number().nullable(),
  offerEndsAt: iso.nullable(),
  /** what the customer pays today (offer price while it runs) */
  effectivePricePaise: z.number(),
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

// ---- Shop app ----

export const shopContextSchema = z.object({
  shopCode: z.string(),
  name: z.string(),
  area: z.string(),
  isLive: z.boolean(),
  visible: z.boolean(),
  openFrom: z.string().nullable(),
  openTo: z.string().nullable(),
  priceVersion: z.number(),
  canEdit: z.boolean(),
  /** the caller's role here: decides which shop tabs they see */
  role: z.enum(['shop_owner', 'shop_staff', 'shop_packer', 'shop_cashier', 'admin']),
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
    barcode: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z-]{4,32}$/, 'Barcode: 4–32 letters, digits or dashes')
      .nullable()
      .optional(),
    stockQty: z.number().int().min(0).max(1_000_000).nullable().optional(),
    offerPricePaise: z.number().int().positive().max(10_000_000).nullable().optional(),
    offerEndsAt: z.string().datetime({ offset: true }).nullable().optional(),
    isSoldOut: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.offerPricePaise == null || v.offerPricePaise < v.pricePaise, {
    message: 'Offer price must be lower than the price',
    path: ['offerPricePaise'],
  });
export type ItemInput = z.input<typeof itemInputSchema>;
export const itemPatchSchema = itemInputSchema.innerType().partial().strict();
export type ItemPatch = z.input<typeof itemPatchSchema>;
export const soldOutSchema = z.object({ isSoldOut: z.boolean() }).strict();

export const shopSettingsSchema = z
  .object({
    openFrom: timeSchema,
    openTo: timeSchema,
  })
  .strict();
export type ShopSettings = z.input<typeof shopSettingsSchema>;

/** The merchant's own daily numbers (their sales, not platform revenue — G4). */
export const footfallRowSchema = z.object({
  day: dateSchema,
  orders: z.number(),
  completed: z.number(),
  cancelled: z.number(),
  salesPaise: z.number(),
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
export const ITEM_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export const imageUploadSchema = z
  .object({
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    base64: z
      .string()
      .min(100)
      .max(Math.ceil((ITEM_IMAGE_MAX_BYTES * 4) / 3) + 8),
  })
  .strict();
export type ImageUpload = z.input<typeof imageUploadSchema>;
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
    gateNotes: z.string().trim().max(300).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type ClusterInput = z.input<typeof clusterInputSchema>;
export const clusterPatchSchema = clusterInputSchema.partial().strict();

export const adminClusterSchema = clusterInfoSchema.extend({
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
  blockedUntil: iso.nullable(),
});
export type BlockedUser = z.infer<typeof blockedUserSchema>;

/**
 * Per-day platform numbers. Fees are the platform's own ₹30 fees; sales are the
 * merchants' bills, shown for reconciliation only (G4: no commission).
 */
export const metricsRowSchema = z.object({
  day: dateSchema,
  ordersPlaced: z.number(),
  completed: z.number(),
  cancelled: z.number(),
  feesPaise: z.number(),
  refundsPaise: z.number(),
  salesPaise: z.number(),
});
export type MetricsRow = z.infer<typeof metricsRowSchema>;

export const metricsSchema = z.object({
  from: dateSchema,
  to: dateSchema,
  visibleShops: z.number(),
  totalShops: z.number(),
  totals: z.object({
    ordersPlaced: z.number(),
    completed: z.number(),
    awaitingMerchant: z.number(),
    feesPaise: z.number(),
    refundsPaise: z.number(),
    netFeesPaise: z.number(),
    salesPaise: z.number(),
  }),
  rows: z.array(metricsRowSchema),
});
export type Metrics = z.infer<typeof metricsSchema>;

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
