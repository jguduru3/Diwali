// Public product photos from the shop-media store. Licence photos live in a
// separate private store and are never served here.
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { HttpError } from '../lib/errors';
import { http } from '../lib/http';
import { fileStore } from '../lib/storage';

const SAFE_PATH = /^items\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpeg|png|webp)$/;

/** GET /api/media/{*path} — paths are unguessable and never reused, so cache for a year. */
export async function mediaHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const path = req.params.path ?? '';
  if (!SAFE_PATH.test(path)) throw new HttpError(404, 'not_found', 'Not found');
  const file = await fileStore('shop-media').get(path);
  if (!file) throw new HttpError(404, 'not_found', 'Not found');
  return {
    status: 200,
    body: file.data,
    headers: {
      'Content-Type': file.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  };
}

http('media', ['GET'], 'media/{*path}', mediaHandler);
