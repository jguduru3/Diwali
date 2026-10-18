import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import bcrypt from 'bcryptjs';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { CONSENT_PURPOSE, otpRequestSchema, otpVerifySchema } from '@pataka/shared';
import { getDb, type Db } from '../db/client';
import { consents, otpRequests, users } from '../db/schema';
import { audit } from '../lib/audit';
import { clearSessionCookie, getSessionUser, sessionCookie, signSession } from '../lib/auth';
import { HttpError } from '../lib/errors';
import { clientIp, parseBody, route } from '../lib/http';
import { toMe } from '../lib/members';
import {
  generateOtp,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
  otpSender,
  type OtpSender,
} from '../lib/otp';
import { rateLimit } from '../lib/rateLimit';

/** POST /api/auth/otp/request — 3 per phone / 10 min, 10 per IP / hour. */
export async function otpRequestHandler(
  req: HttpRequest,
  db: Db = getDb(),
  sender: OtpSender = otpSender(),
): Promise<HttpResponseInit> {
  const { phone } = await parseBody(req, otpRequestSchema);
  const ip = clientIp(req);
  await rateLimit(db, `otp:phone:${phone}`, 3, 10 * 60);
  if (ip) await rateLimit(db, `otp:ip:${ip}`, 10, 60 * 60);

  const code = generateOtp();
  await db.insert(otpRequests).values({
    phoneE164: phone,
    codeHash: await bcrypt.hash(code, 10),
    expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
    ip,
  });
  await sender.send(phone, code);
  return { status: 200, jsonBody: { sent: true, expiresInSeconds: OTP_TTL_SECONDS } };
}

/** POST /api/auth/otp/verify — creates the user + consent on first sign-in, sets the cookie. */
export async function otpVerifyHandler(
  req: HttpRequest,
  db: Db = getDb(),
): Promise<HttpResponseInit> {
  const { phone, code, consentVersion } = await parseBody(req, otpVerifySchema);

  const [otp] = await db
    .select()
    .from(otpRequests)
    .where(
      and(
        eq(otpRequests.phoneE164, phone),
        isNull(otpRequests.consumedAt),
        gt(otpRequests.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(otpRequests.createdAt))
    .limit(1);
  if (!otp) throw new HttpError(400, 'otp_expired', 'Code expired. Request a new one.');

  // Count the attempt before comparing so parallel guesses cannot exceed the cap.
  const [counted] = await db
    .update(otpRequests)
    .set({ attempts: sql`${otpRequests.attempts} + 1` })
    .where(and(eq(otpRequests.id, otp.id), sql`${otpRequests.attempts} < ${OTP_MAX_ATTEMPTS}`))
    .returning({ attempts: otpRequests.attempts });
  if (!counted) throw new HttpError(429, 'otp_locked', 'Too many wrong codes. Request a new one.');
  if (!(await bcrypt.compare(code, otp.codeHash))) {
    throw new HttpError(400, 'otp_wrong', 'Wrong code');
  }

  const user = await db.transaction(async (tx) => {
    const [consumed] = await tx
      .update(otpRequests)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(otpRequests.id, otp.id), isNull(otpRequests.consumedAt)))
      .returning({ id: otpRequests.id });
    if (!consumed) throw new HttpError(400, 'otp_expired', 'Code already used. Request a new one.');

    let [u] = await tx.select().from(users).where(eq(users.phoneE164, phone)).limit(1);
    if (!u) {
      [u] = await tx.insert(users).values({ phoneE164: phone }).returning();
    }
    const userRow = u!;

    const [hasConsent] = await tx
      .select({ id: consents.id })
      .from(consents)
      .where(
        and(
          eq(consents.userId, userRow.id),
          eq(consents.version, consentVersion),
          isNull(consents.withdrawnAt),
        ),
      )
      .limit(1);
    if (!hasConsent) {
      await tx
        .insert(consents)
        .values({ userId: userRow.id, purpose: CONSENT_PURPOSE, version: consentVersion });
    }
    await audit(tx, {
      actorUserId: userRow.id,
      action: 'auth.login',
      entity: 'user',
      entityId: userRow.id,
    });
    return userRow;
  });

  const { token, ttl } = await signSession(user);
  return {
    status: 200,
    jsonBody: await toMe(db, user),
    cookies: [sessionCookie(token, ttl)],
  };
}

/** POST /api/auth/logout — revokes every session of this user and clears the cookie. */
export async function logoutHandler(req: HttpRequest, db: Db = getDb()): Promise<HttpResponseInit> {
  const user = await getSessionUser(db, req);
  if (user) {
    await db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, user.id));
    await audit(db, {
      actorUserId: user.id,
      action: 'auth.logout',
      entity: 'user',
      entityId: user.id,
    });
  }
  return { status: 204, cookies: [clearSessionCookie()] };
}

app.http('authOtpRequest', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/otp/request',
  handler: route((req) => otpRequestHandler(req)),
});

app.http('authOtpVerify', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/otp/verify',
  handler: route((req) => otpVerifyHandler(req)),
});

app.http('authLogout', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/logout',
  handler: route((req) => logoutHandler(req)),
});
