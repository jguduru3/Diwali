import type { HttpResponseInit } from '@azure/functions';
import type { ApiError } from '@pataka/shared';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, 'unauthorized', 'Sign in to continue');
export const forbidden = () =>
  new HttpError(403, 'forbidden', 'You do not have access to this area');

export function errorResponse(status: number, code: string, message: string): HttpResponseInit {
  const body: ApiError = { error: { code, message } };
  return { status, jsonBody: body };
}
