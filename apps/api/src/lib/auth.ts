import type { HttpRequest } from '@azure/functions';
import { eq } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { hasRole, isStaffRole, SESSION_COOKIE, type Role } from '@pataka/shared';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { env } from './env';
import { forbidden, unauthorized } from './errors';

const CUSTOMER_TTL_SECONDS = 30 * 24 * 60 * 60;
const STAFF_TTL_SECONDS = 12 * 60 * 60;

export type SessionUser = typeof users.$inferSelect;

export function sessionTtlSeconds(role: Role): number {
  return isStaffRole(role) ? STAFF_TTL_SECONDS : CUSTOMER_TTL_SECONDS;
}

export async function signSession(user: Pick<SessionUser, 'id' | 'role' | 'tokenVersion'>) {
  const ttl = sessionTtlSeconds(user.role);
  const token = await new SignJWT({ role: user.role, ver: user.tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(env.jwtSecret());
  return { token, ttl };
}

type Cookie = {
  name: string;
  value: string;
  maxAge: number;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax';
};

export function sessionCookie(token: string, maxAge: number): Cookie {
  return {
    name: SESSION_COOKIE,
    value: token,
    maxAge,
    path: '/',
    httpOnly: true,
    secure: env.cookieSecure(),
    sameSite: 'Lax',
  };
}

export const clearSessionCookie = (): Cookie => sessionCookie('', 0);

function readCookie(req: HttpRequest, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Returns the signed-in user, or null. The role always comes from the DB row,
 * never the token, so role changes take effect at once; the token's `ver` must
 * match the row so logout / delete / role change revoke old sessions.
 */
export async function getSessionUser(db: Db, req: HttpRequest): Promise<SessionUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  let sub: string | undefined;
  let ver: unknown;
  try {
    const { payload } = await jwtVerify(token, env.jwtSecret(), { algorithms: ['HS256'] });
    sub = payload.sub;
    ver = payload.ver;
  } catch {
    return null;
  }
  if (!sub) return null;
  const [user] = await db.select().from(users).where(eq(users.id, sub)).limit(1);
  if (!user || user.deletedAt || user.tokenVersion !== ver) return null;
  return user;
}

export async function requireUser(db: Db, req: HttpRequest): Promise<SessionUser> {
  const user = await getSessionUser(db, req);
  if (!user) throw unauthorized();
  return user;
}

/** 401 when signed out, 403 when the role is not in `allowed`. */
export async function requireRole(
  db: Db,
  req: HttpRequest,
  allowed: readonly Role[],
): Promise<SessionUser> {
  const user = await requireUser(db, req);
  if (!hasRole(user.role, allowed)) throw forbidden();
  return user;
}
