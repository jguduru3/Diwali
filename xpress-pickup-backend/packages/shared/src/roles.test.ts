import { describe, expect, it } from 'vitest';
import { canAccessArea, homePathForRole, isStaffRole } from './roles';
import { assignRoleSchema } from './schemas';

describe('area access', () => {
  it.each([
    ['customer', false, false, false],
    ['shop_owner', true, false, false],
    ['shop_staff', true, false, false],
    ['marshal', false, true, false],
    ['admin', true, true, true],
  ] as const)('%s → shop:%s gate:%s admin:%s', (role, shop, gate, admin) => {
    expect(canAccessArea(role, 'shop')).toBe(shop);
    expect(canAccessArea(role, 'gate')).toBe(gate);
    expect(canAccessArea(role, 'admin')).toBe(admin);
  });

  it('signed-out visitors reach no protected area', () => {
    expect(canAccessArea(null, 'shop')).toBe(false);
    expect(canAccessArea(undefined, 'admin')).toBe(false);
  });

  it('only customers get long sessions', () => {
    expect(isStaffRole('customer')).toBe(false);
    expect(isStaffRole('shop_staff')).toBe(true);
  });

  it('sends each role to its own area after sign-in', () => {
    expect(homePathForRole('customer')).toBe('/');
    expect(homePathForRole('shop_owner')).toBe('/shop');
    expect(homePathForRole('marshal')).toBe('/gate');
    expect(homePathForRole('admin')).toBe('/admin');
  });
});

describe('assignRoleSchema', () => {
  const phone = '9876543210';

  it('requires a shop for vendor roles', () => {
    expect(assignRoleSchema.safeParse({ phone, role: 'shop_owner' }).success).toBe(false);
    expect(
      assignRoleSchema.safeParse({ phone, role: 'shop_owner', shopShortCode: 'slc01' }).data,
    ).toMatchObject({ phone: '+919876543210', shopShortCode: 'SLC01' });
  });

  it('requires a cluster for marshals', () => {
    expect(assignRoleSchema.safeParse({ phone, role: 'marshal' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(assignRoleSchema.safeParse({ phone, role: 'admin', extra: 1 }).success).toBe(false);
  });
});
