import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { HttpError } from './errors';

/**
 * Fixed-window counter in the rate_limits table. Atomic: one upsert per hit.
 * Throws 429 once `limit` hits have been counted in the current window.
 */
export async function rateLimit(db: Db, key: string, limit: number, windowSeconds: number) {
  const res = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then now() else rate_limits.window_start end
    returning count`);
  const count = Number(res.rows[0]?.count ?? 0);
  if (count > limit) {
    throw new HttpError(429, 'rate_limited', 'Too many attempts. Please try again later.');
  }
}
