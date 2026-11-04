import {
  apiErrorSchema,
  CSRF_HEADER,
  healthResponseSchema,
  type HealthResponse,
} from '@pataka/shared';
import type { ZodType, ZodTypeDef } from 'zod';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
/**
 * Same-origin by default (Front Door serves the app and /api on one domain). When the API is
 * on another domain (VITE_API_BASE=https://api.example.in/api) the session cookie is sent too;
 * the API must then allow this origin (CORS) and use SameSite=None cookies.
 */
const CREDENTIALS: RequestCredentials = /^https?:\/\//.test(API_BASE) ? 'include' : 'same-origin';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Options<T> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  schema?: ZodType<T, ZodTypeDef, unknown>;
  headers?: Record<string, string>;
};

/** Same-origin JSON call. Adds the CSRF header on mutations; throws ApiRequestError on non-2xx. */
export async function api<T = void>(
  path: string,
  { method = 'GET', body, schema, headers: extra }: Options<T> = {},
) {
  const headers: Record<string, string> = { ...extra };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers[CSRF_HEADER] = '1';

  const send = async (cache?: RequestCache) => {
    const init: RequestInit = {
      method,
      headers,
      credentials: CREDENTIALS,
      cache,
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    let res = await fetch(`${API_BASE}${path}`, init);
    // A bodyless 304 can reach us when the browser's cached copy is gone; fetch afresh once.
    if (res.status === 304) res = await fetch(`${API_BASE}${path}`, { ...init, cache: 'reload' });
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const parsed = apiErrorSchema.safeParse(json);
      throw parsed.success
        ? new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message)
        : new ApiRequestError(res.status, 'http_error', res.statusText);
    }
    return json;
  };

  const json = await send();
  if (!schema) return json as T;
  const parsed = schema.safeParse(json);
  if (parsed.success) return parsed.data;
  // A GET that doesn't match today's schema is most likely a copy the browser cached before a
  // release changed the response. Fetch it once more past the HTTP cache before giving up.
  if (method === 'GET') return schema.parse(await send('reload'));
  throw parsed.error;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`, { credentials: CREDENTIALS });
  // 503 still carries a valid body
  return healthResponseSchema.parse(await res.json());
}
