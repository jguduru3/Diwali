// Merchant documents (besides the trading licence on the Licence tab): five categories, each
// uploaded by the owner and checked by a platform admin.
import { z } from 'zod';

export const MERCHANT_DOC_TYPES = [
  'fire_licence',
  'police_clearance',
  'govt_authority_licence',
  'gst_certificate',
  'business_registration',
] as const;
export type MerchantDocType = (typeof MERCHANT_DOC_TYPES)[number];

export const DOC_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

/** Licences and clearances expire; registrations do not. */
export const DOC_NEEDS_EXPIRY: Record<MerchantDocType, boolean> = {
  fire_licence: true,
  police_clearance: true,
  govt_authority_licence: true,
  gst_certificate: false,
  business_registration: false,
};

export const DOC_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const DOC_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

// ---- GSTIN (15 characters: state code, PAN, entity number, 'Z', check character) ----

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Check character for the first 14 characters of a GSTIN (GSTN's base-36 algorithm). */
export function gstinChecksum(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GST_CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36]!;
}

export function isValidGstin(raw: string): boolean {
  const v = raw.trim().toUpperCase();
  const m = GSTIN_SHAPE.exec(v);
  if (!m) return false;
  const state = Number(m[1]);
  // 01–38 are states and union territories; 97 is "other territory", 99 the centre.
  if (!((state >= 1 && state <= 38) || state === 97)) return false;
  return gstinChecksum(v.slice(0, 14)) === v[14];
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const documentSubmitSchema = z
  .object({
    docType: z.enum(MERCHANT_DOC_TYPES),
    /** licence / certificate / registration number; the GSTIN for the GST certificate */
    docNumber: z.string().trim().min(3).max(60),
    issuedBy: z.string().trim().max(100).optional(),
    validFrom: date.optional(),
    validTo: date.optional(),
    file: z
      .object({
        contentType: z.enum(DOC_CONTENT_TYPES),
        base64: z
          .string()
          .min(100)
          .max(Math.ceil((DOC_FILE_MAX_BYTES * 4) / 3) + 8),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.docType === 'gst_certificate' && !isValidGstin(v.docNumber)) {
      ctx.addIssue({
        code: 'custom',
        path: ['docNumber'],
        message: 'Enter a valid 15-character GSTIN',
      });
    }
    if (DOC_NEEDS_EXPIRY[v.docType] && !v.validTo) {
      ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'Enter the valid-to date' });
    }
    if (v.validFrom && v.validTo && v.validFrom > v.validTo) {
      ctx.addIssue({
        code: 'custom',
        path: ['validFrom'],
        message: 'Valid-from must be before valid-to',
      });
    }
  })
  .transform((v) =>
    v.docType === 'gst_certificate' ? { ...v, docNumber: v.docNumber.toUpperCase() } : v,
  );
export type DocumentSubmit = z.input<typeof documentSubmitSchema>;

export const shopDocumentSchema = z.object({
  id: z.string().uuid(),
  docType: z.enum(MERCHANT_DOC_TYPES),
  docNumber: z.string(),
  issuedBy: z.string().nullable(),
  validFrom: date.nullable(),
  validTo: date.nullable(),
  status: z.enum(DOC_STATUSES),
  /** admin's note; the reason when rejected */
  notes: z.string().nullable(),
  contentType: z.enum(DOC_CONTENT_TYPES),
  sizeBytes: z.number(),
  uploadedAt: z.string(),
  verifiedAt: z.string().nullable(),
  /** past the valid-to date (only for documents that expire) */
  isExpired: z.boolean(),
});
export type ShopDocument = z.infer<typeof shopDocumentSchema>;

/** One slot per document type: the current upload (or none) and how many it replaced. */
export const shopDocumentSlotSchema = z.object({
  docType: z.enum(MERCHANT_DOC_TYPES),
  current: shopDocumentSchema.nullable(),
  replacedCount: z.number(),
});
export type ShopDocumentSlot = z.infer<typeof shopDocumentSlotSchema>;

export const adminDocumentSchema = shopDocumentSchema.extend({
  shopId: z.string().uuid(),
  shopCode: z.string(),
  shopName: z.string(),
});
export type AdminDocument = z.infer<typeof adminDocumentSchema>;

export const documentDecisionSchema = z
  .object({ notes: z.string().trim().max(300).optional() })
  .strict();
/** Rejecting needs a reason the owner can act on. */
export const documentRejectSchema = z.object({ notes: z.string().trim().min(3).max(300) }).strict();
