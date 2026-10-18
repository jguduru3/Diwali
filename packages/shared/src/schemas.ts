import { z } from 'zod';
import { CONSENT_VERSION } from './constants';
import { normalizeIndianPhone } from './phone';
import { ROLES } from './roles';

export const healthResponseSchema = z
  .object({
    ok: z.boolean(),
    db: z.boolean(),
  })
  .strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const roleSchema = z.enum(ROLES);

/** Accepts loose Indian formats and outputs E.164. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const e164 = normalizeIndianPhone(v);
    if (!e164) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid Indian mobile number' });
      return z.NEVER;
    }
    return e164;
  });

// ---- Auth ----

export const otpRequestSchema = z.object({ phone: phoneSchema }).strict();
export type OtpRequest = z.input<typeof otpRequestSchema>;

export const otpVerifySchema = z
  .object({
    phone: phoneSchema,
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
    consentVersion: z.literal(CONSENT_VERSION),
  })
  .strict();
export type OtpVerify = z.input<typeof otpVerifySchema>;

export const membershipSchema = z.object({
  kind: z.enum(['shop', 'cluster']),
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  role: roleSchema,
});
export type Membership = z.infer<typeof membershipSchema>;

export const meSchema = z.object({
  id: z.string().uuid(),
  phone: z.string(),
  displayName: z.string().nullable(),
  role: roleSchema,
  memberships: z.array(membershipSchema),
});
export type Me = z.infer<typeof meSchema>;

// ---- Admin: role assignment ----

/**
 * Give a phone number a role. Vendor roles need a shop, marshal needs a cluster.
 * Setting role "customer" removes all staff memberships.
 */
export const assignRoleSchema = z
  .object({
    phone: phoneSchema,
    role: roleSchema,
    shopShortCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{3,6}$/)
      .optional(),
    clusterId: z.string().uuid().optional(),
    displayName: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.role === 'shop_owner' || v.role === 'shop_staff') && !v.shopShortCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shopShortCode'],
        message: 'Shop is required for vendor roles',
      });
    }
    if (v.role === 'marshal' && !v.clusterId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clusterId'],
        message: 'Cluster is required for marshals',
      });
    }
  });
export type AssignRole = z.input<typeof assignRoleSchema>;

export const staffMemberSchema = z.object({
  userId: z.string().uuid(),
  phone: z.string(),
  displayName: z.string().nullable(),
  role: roleSchema,
  memberships: z.array(membershipSchema),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

export const adminMembersResponseSchema = z.object({
  members: z.array(staffMemberSchema),
  shops: z.array(z.object({ id: z.string().uuid(), shortCode: z.string(), name: z.string() })),
  clusters: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});
export type AdminMembersResponse = z.infer<typeof adminMembersResponseSchema>;
