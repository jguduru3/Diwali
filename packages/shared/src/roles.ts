/**
 * Roles (SPEC §2, §6.1). Product names used with the owner:
 *   User   → customer
 *   Vendor → shop_owner (merchant: full shop control) | shop_staff (accept orders,
 *            counter) | shop_packer (packing only) | shop_cashier (Express Pickup counter)
 *   Marshal→ marshal (cluster gate)
 *   Admin  → admin (Truerenewables team)
 */
export const ROLES = [
  'customer',
  'shop_owner',
  'shop_staff',
  'marshal',
  'admin',
  'shop_packer',
  'shop_cashier',
] as const;
export type Role = (typeof ROLES)[number];

export const VENDOR_ROLES = [
  'shop_owner',
  'shop_staff',
  'shop_packer',
  'shop_cashier',
] as const satisfies readonly Role[];
export type VendorRole = (typeof VENDOR_ROLES)[number];

/** Staff sessions are short-lived (12 h); customers stay signed in for 30 days. */
export const STAFF_ROLES = [
  'shop_owner',
  'shop_staff',
  'shop_packer',
  'shop_cashier',
  'marshal',
  'admin',
] as const satisfies readonly Role[];

/** Which roles may open each app area. Admin can open every area for support. */
export const AREA_ROLES = {
  shop: ['shop_owner', 'shop_staff', 'shop_packer', 'shop_cashier', 'admin'],
  gate: ['marshal', 'admin'],
  admin: ['admin'],
} as const satisfies Record<string, readonly Role[]>;
export type Area = keyof typeof AREA_ROLES;

export function hasRole(role: Role | undefined | null, allowed: readonly Role[]): boolean {
  return role != null && allowed.includes(role);
}

export function isStaffRole(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

export function canAccessArea(role: Role | undefined | null, area: Area): boolean {
  return hasRole(role, AREA_ROLES[area]);
}

/** Where to land after sign-in when no explicit return path was given. */
export function homePathForRole(role: Role): string {
  switch (role) {
    case 'shop_owner':
    case 'shop_staff':
      return '/shop';
    case 'shop_packer':
      return '/shop/packing';
    case 'shop_cashier':
      return '/shop/counter';
    case 'marshal':
      return '/gate';
    case 'admin':
      return '/admin';
    default:
      return '/';
  }
}
