import {
  app,
  type HttpMethod,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { CSRF_HEADER } from '@pataka/shared';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import { errorResponse, HttpError } from './errors';

type Handler = (req: HttpRequest, ctx: InvocationContext) => Promise<HttpResponseInit>;

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type PgError = { code?: string; constraint?: string; message?: string };

/** The underlying Postgres error (Drizzle wraps it in `cause`), or null. */
export function pgError(err: unknown): PgError | null {
  let e = err as (PgError & { cause?: unknown }) | null;
  for (let i = 0; e && i < 3; i++) {
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    e = e.cause as (PgError & { cause?: unknown }) | null;
  }
  return null;
}

/** Postgres error → API error, for the constraint names we rely on. */
function mapPgError(err: unknown): HttpError | null {
  const e = pgError(err);
  if (typeof e?.code !== 'string') return null;
  if (e.code === '23514' && e.message?.includes('banned')) {
    return new HttpError(422, 'category_banned', 'This category is banned and cannot be used');
  }
  if (e.code === '23505' && e.constraint === 'one_open_pass') {
    return new HttpError(409, 'pass_exists', 'You already have an Express Pass');
  }
  if (e.code === '23505' && e.constraint === 'items_shop_barcode') {
    return new HttpError(409, 'barcode_taken', 'Another product in this shop has that barcode');
  }
  if (e.code === '23505' && e.constraint === 'shop_documents_one_current') {
    return new HttpError(
      409,
      'document_changed',
      'This document was just replaced; reload and try again',
    );
  }
  if (e.code === '23505') return new HttpError(409, 'duplicate', 'That already exists');
  if (e.code === '23514') return new HttpError(422, 'invalid_value', 'A value is not allowed');
  return null;
}

/**
 * Responses that do not choose their own caching are never stored by a browser or the edge:
 * only the public catalogue opts in (Cache-Control public, see functions/public.ts).
 */
function noStoreByDefault(res: HttpResponseInit): HttpResponseInit {
  const h = res.headers;
  const isCacheControl = (k: string) => k.toLowerCase() === 'cache-control';
  if (h instanceof Headers) {
    if (!h.has('cache-control')) h.set('Cache-Control', 'no-store');
    return res;
  }
  const entries: [string, string][] = Array.isArray(h)
    ? (h as [string, string][])
    : Object.entries((h ?? {}) as Record<string, string>);
  if (entries.some(([k]) => isCacheControl(k))) return res;
  return { ...res, headers: Object.fromEntries([...entries, ['Cache-Control', 'no-store']]) };
}

/**
 * Wraps a handler with: CSRF header check on mutations (SPEC §10),
 * HttpError/ZodError/Postgres errors → JSON error body, a 500 fallback, and
 * Cache-Control: no-store unless the handler set its own caching.
 */
export function route(handler: Handler): Handler {
  return async (req, ctx) => noStoreByDefault(await handle(handler, req, ctx));
}

async function handle(
  handler: Handler,
  req: Parameters<Handler>[0],
  ctx: Parameters<Handler>[1],
): Promise<HttpResponseInit> {
  try {
    if (MUTATING.has(req.method) && req.headers.get(CSRF_HEADER) !== '1') {
      throw new HttpError(403, 'csrf', 'Missing request header');
    }
    return await handler(req, ctx);
  } catch (err) {
    const mapped = err instanceof HttpError ? err : mapPgError(err);
    if (mapped) return errorResponse(mapped.status, mapped.code, mapped.message);
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      return errorResponse(400, 'invalid_body', `${where}${issue?.message ?? 'Invalid request'}`);
    }
    ctx.error(err);
    return errorResponse(500, 'internal', 'Something went wrong');
  }
}

/** Registers an anonymous-level HTTP function; auth is enforced inside the handler. */
export function http(
  name: string,
  methods: HttpMethod[],
  path: string,
  handler: (req: HttpRequest) => Promise<HttpResponseInit>,
) {
  app.http(name, {
    methods,
    authLevel: 'anonymous',
    route: path,
    handler: route((r) => handler(r)),
  });
}

export async function parseBody<T>(req: HttpRequest, schema: ZodType<T, ZodTypeDef, unknown>) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be JSON');
  }
  return schema.parse(raw);
}

export function parseQuery<T>(value: string | null, schema: ZodType<T, ZodTypeDef, unknown>) {
  return schema.parse(value ?? undefined);
}

/** Client IP as seen by Front Door (first X-Forwarded-For hop), without port. */
export function clientIp(req: HttpRequest): string | null {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!first) return null;
  // strip ":port" from IPv4 forms like 1.2.3.4:5678
  return /^\d+\.\d+\.\d+\.\d+:\d+$/.test(first) ? first.split(':')[0]! : first;
}

export const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  ({
    status,
    jsonBody: body,
    headers: { 'Cache-Control': 'no-store', ...headers },
  }) satisfies HttpResponseInit;
