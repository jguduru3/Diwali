import { describe, expect, it } from 'vitest';
import { adminMembersResponseSchema, meSchema, staffMemberSchema } from '@pataka/shared';
import { assignRoleHandler, listMembersHandler } from '../src/functions/adminMembers';
import { getMeHandler } from '../src/functions/me';
import { call, errorCode, makeAdmin, makeShop, signIn } from './helpers';

const ADMIN = '+919000000001';
const VENDOR = '+919000000011';
const CUSTOMER = '+919000000099';

describe('admin-only endpoints', () => {
  it('401 when signed out, 403 for customers and vendors, 200 for admins', async () => {
    const { shop } = await makeShop();
    await makeAdmin(ADMIN);
    const admin = await signIn(ADMIN);
    const customer = await signIn(CUSTOMER);

    await call(assignRoleHandler, {
      method: 'POST',
      session: admin,
      body: { phone: VENDOR, role: 'shop_owner', shopShortCode: shop.shortCode },
    });
    const vendor = await signIn(VENDOR);

    expect((await call(listMembersHandler)).status).toBe(401);
    expect(errorCode(await call(listMembersHandler, { session: customer }))).toBe('forbidden');
    expect((await call(listMembersHandler, { session: vendor })).status).toBe(403);

    const ok = await call(listMembersHandler, { session: admin });
    expect(ok.status).toBe(200);
    const body = adminMembersResponseSchema.parse(ok.jsonBody);
    expect(body.members.map((m) => m.role).sort()).toEqual(['admin', 'shop_owner']);
    expect(body.shops).toHaveLength(1);
  });

  it('customers cannot grant themselves a role', async () => {
    const customer = await signIn(CUSTOMER);
    const res = await call(assignRoleHandler, {
      method: 'POST',
      session: customer,
      body: { phone: CUSTOMER, role: 'admin' },
    });
    expect(res.status).toBe(403);
  });
});

describe('assigning roles', () => {
  it('makes a vendor of a shop; the new role applies at the next sign-in', async () => {
    const { shop } = await makeShop();
    await makeAdmin(ADMIN);
    const admin = await signIn(ADMIN);
    const before = await signIn(VENDOR); // signed in as a customer first

    const res = await call(assignRoleHandler, {
      method: 'POST',
      session: admin,
      body: {
        phone: '9000000011',
        role: 'shop_staff',
        shopShortCode: 'slc01',
        displayName: 'Ravi',
      },
    });
    expect(res.status).toBe(200);
    expect(staffMemberSchema.parse(res.jsonBody)).toMatchObject({
      phone: VENDOR,
      role: 'shop_staff',
      displayName: 'Ravi',
      memberships: [{ kind: 'shop', id: shop.id, code: 'SLC01', role: 'shop_staff' }],
    });

    // Role change revokes the old customer session.
    expect((await call(getMeHandler, { session: before })).status).toBe(401);
    const after = await signIn(VENDOR);
    expect(meSchema.parse((await call(getMeHandler, { session: after })).jsonBody).role).toBe(
      'shop_staff',
    );
  });

  it('makes a marshal of a cluster', async () => {
    const { cluster } = await makeShop();
    await makeAdmin(ADMIN);
    const admin = await signIn(ADMIN);
    const res = await call(assignRoleHandler, {
      method: 'POST',
      session: admin,
      body: { phone: '+919000000051', role: 'marshal', clusterId: cluster.id },
    });
    expect(staffMemberSchema.parse(res.jsonBody).memberships).toEqual([
      { kind: 'cluster', id: cluster.id, name: cluster.name, code: null, role: 'marshal' },
    ]);
  });

  it('moving a vendor back to customer removes shop access', async () => {
    await makeShop();
    await makeAdmin(ADMIN);
    const admin = await signIn(ADMIN);
    const body = { phone: VENDOR, role: 'shop_owner', shopShortCode: 'SLC01' };
    await call(assignRoleHandler, { method: 'POST', session: admin, body });
    const res = await call(assignRoleHandler, {
      method: 'POST',
      session: admin,
      body: { phone: VENDOR, role: 'customer' },
    });
    expect(staffMemberSchema.parse(res.jsonBody)).toMatchObject({
      role: 'customer',
      memberships: [],
    });
  });

  it('rejects unknown shops, missing shop codes and self-demotion', async () => {
    await makeAdmin(ADMIN);
    const admin = await signIn(ADMIN);
    const unknown = await call(assignRoleHandler, {
      method: 'POST',
      session: admin,
      body: { phone: VENDOR, role: 'shop_owner', shopShortCode: 'NOPE1' },
    });
    expect(errorCode(unknown)).toBe('shop_not_found');

    const missing = await call(assignRoleHandler, {
      method: 'POST',
      session: admin,
      body: { phone: VENDOR, role: 'shop_owner' },
    });
    expect(missing.status).toBe(400);

    const self = await call(assignRoleHandler, {
      method: 'POST',
      session: admin,
      body: { phone: ADMIN, role: 'customer' },
    });
    expect(errorCode(self)).toBe('self_demote');
  });
});
