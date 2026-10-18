import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { CONSENT_VERSION, meSchema } from '@pataka/shared';
import { getDb, getPool } from '../src/db/client';
import { consents, users } from '../src/db/schema';
import { logoutHandler, otpRequestHandler, otpVerifyHandler } from '../src/functions/auth';
import { deleteMeHandler, getMeHandler } from '../src/functions/me';
import { call, errorCode, sessionFrom, signIn } from './helpers';

const PHONE = '+919876543210';

const verify = (code: string, phone = PHONE) =>
  call(otpVerifyHandler, {
    method: 'POST',
    body: { phone, code, consentVersion: CONSENT_VERSION },
  });

describe('OTP sign-in', () => {
  it('happy path: creates a customer with consent and sets an httpOnly cookie', async () => {
    const req = await call(otpRequestHandler, { method: 'POST', body: { phone: '98765 43210' } });
    expect(req.status).toBe(200);

    const res = await verify('123456');
    expect(res.status).toBe(200);
    const me = meSchema.parse(res.jsonBody);
    expect(me).toMatchObject({ phone: PHONE, role: 'customer', memberships: [] });

    const cookie = res.cookies?.[0];
    expect(cookie).toMatchObject({ name: 'pp_session', httpOnly: true, sameSite: 'Lax' });
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);

    const rows = await getDb().select().from(consents).where(eq(consents.userId, me.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: CONSENT_VERSION, withdrawnAt: null });
  });

  it('staff get a 12-hour session', async () => {
    await getDb().insert(users).values({ phoneE164: PHONE, role: 'shop_staff' });
    await call(otpRequestHandler, { method: 'POST', body: { phone: PHONE } });
    const res = await verify('123456');
    expect(res.cookies?.[0]?.maxAge).toBe(12 * 60 * 60);
  });

  it('wrong code is rejected, and the code locks after 5 attempts', async () => {
    await call(otpRequestHandler, { method: 'POST', body: { phone: PHONE } });
    for (let i = 0; i < 5; i++) {
      expect(errorCode(await verify('000000'))).toBe('otp_wrong');
    }
    const locked = await verify('123456');
    expect(locked.status).toBe(429);
    expect(errorCode(locked)).toBe('otp_locked');
  });

  it('expired code is rejected', async () => {
    await call(otpRequestHandler, { method: 'POST', body: { phone: PHONE } });
    await getPool().query(`update otp_requests set expires_at = now() - interval '1 minute'`);
    expect(errorCode(await verify('123456'))).toBe('otp_expired');
  });

  it('a code cannot be used twice', async () => {
    await call(otpRequestHandler, { method: 'POST', body: { phone: PHONE } });
    expect((await verify('123456')).status).toBe(200);
    expect(errorCode(await verify('123456'))).toBe('otp_expired');
  });

  it('rate-limits OTP requests per phone (3 / 10 min)', async () => {
    for (let i = 0; i < 3; i++) {
      expect(
        (await call(otpRequestHandler, { method: 'POST', body: { phone: PHONE } })).status,
      ).toBe(200);
    }
    const res = await call(otpRequestHandler, { method: 'POST', body: { phone: PHONE } });
    expect(res.status).toBe(429);
  });

  it('rate-limits OTP requests per IP (10 / hour)', async () => {
    for (let i = 0; i < 10; i++) {
      const phone = `+91987654320${i}`;
      const res = await call(otpRequestHandler, {
        method: 'POST',
        body: { phone },
        ip: '203.0.113.7',
      });
      expect(res.status).toBe(200);
    }
    const res = await call(otpRequestHandler, {
      method: 'POST',
      body: { phone: '+919876543299' },
      ip: '203.0.113.7',
    });
    expect(res.status).toBe(429);
  });

  it('rejects mutations without the X-PP header (CSRF)', async () => {
    const res = await call(otpRequestHandler, {
      method: 'POST',
      body: { phone: PHONE },
      csrf: false,
    });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('csrf');
  });

  it('rejects unknown body keys and bad phone numbers', async () => {
    const extra = await call(otpRequestHandler, {
      method: 'POST',
      body: { phone: PHONE, items: [] },
    });
    expect(extra.status).toBe(400);
    const bad = await call(otpRequestHandler, { method: 'POST', body: { phone: '12345' } });
    expect(bad.status).toBe(400);
  });

  it('requires the current consent version', async () => {
    await call(otpRequestHandler, { method: 'POST', body: { phone: PHONE } });
    const res = await call(otpVerifyHandler, {
      method: 'POST',
      body: { phone: PHONE, code: '123456', consentVersion: 'old' },
    });
    expect(res.status).toBe(400);
  });
});

describe('sessions', () => {
  it('GET /me is 401 when signed out and returns the profile when signed in', async () => {
    expect((await call(getMeHandler)).status).toBe(401);
    const session = await signIn(PHONE);
    const res = await call(getMeHandler, { session });
    expect(res.status).toBe(200);
    expect(meSchema.parse(res.jsonBody).phone).toBe(PHONE);
  });

  it('rejects a tampered token', async () => {
    const session = await signIn(PHONE);
    expect((await call(getMeHandler, { session: session.slice(0, -2) + 'xx' })).status).toBe(401);
  });

  it('logout revokes the session even if the cookie is replayed', async () => {
    const session = await signIn(PHONE);
    const out = await call(logoutHandler, { method: 'POST', session });
    expect(out.status).toBe(204);
    expect(sessionFrom(out)).toBe('');
    expect((await call(getMeHandler, { session })).status).toBe(401);
  });

  it('DELETE /me anonymises the account; signing in again starts a fresh account', async () => {
    const session = await signIn(PHONE);
    const me = meSchema.parse((await call(getMeHandler, { session })).jsonBody);

    const del = await call(deleteMeHandler, { method: 'DELETE', session });
    expect(del.status).toBe(204);
    expect((await call(getMeHandler, { session })).status).toBe(401);

    const [row] = await getDb().select().from(users).where(eq(users.id, me.id));
    expect(row?.phoneE164).toBe(`deleted:${me.id}`);
    expect(row?.deletedAt).not.toBeNull();
    const [consent] = await getDb().select().from(consents).where(eq(consents.userId, me.id));
    expect(consent?.withdrawnAt).not.toBeNull();

    const again = await signIn(PHONE);
    const fresh = meSchema.parse((await call(getMeHandler, { session: again })).jsonBody);
    expect(fresh.id).not.toBe(me.id);
  });
});
