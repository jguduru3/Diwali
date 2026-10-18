import {
  apiErrorSchema,
  CSRF_HEADER,
  healthResponseSchema,
  type HealthResponse,
} from '@pataka/shared';
import type { ZodType, ZodTypeDef } from 'zod';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

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
};

/** Same-origin JSON call. Adds the CSRF header on mutations; throws ApiRequestError on non-2xx. */
export async function api<T = void>(
  path: string,
  { method = 'GET', body, schema }: Options<T> = {},
) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers[CSRF_HEADER] = '1';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    throw parsed.success
      ? new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiRequestError(res.status, 'http_error', res.statusText);
  }
  return (schema ? schema.parse(json) : json) as T;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`, { credentials: 'same-origin' });
  // 503 still carries a valid body
  return healthResponseSchema.parse(await res.json());
}
