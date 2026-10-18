// Timer triggers. Schedules are UTC (NCRONTAB with seconds); IST = UTC+5:30.
import { app, type InvocationContext } from '@azure/functions';
import { getDb } from '../db/client';
import { expireLicences, purge, snapshotDailyStats } from '../lib/jobs';
import { expireUnconfirmed } from '../lib/orders';

function timer(name: string, schedule: string, job: () => Promise<unknown>) {
  app.timer(name, {
    schedule,
    handler: async (_t, ctx: InvocationContext) => {
      const result = await job();
      ctx.log(`${name}: ${JSON.stringify(result)}`);
    },
  });
}

// Orders not confirmed within 3 days expire and the ₹30 fee is refunded (SPEC_V3 §4).
timer('orderExpiry', '0 10 * * * *', () => expireUnconfirmed(getDb()));
timer('licenceExpiry', '0 0 * * * *', () => expireLicences(getDb()));
timer('dailyStats', '0 25 18 * * *', () => snapshotDailyStats(getDb())); // 23:55 IST
timer('purge', '0 30 21 * * *', () => purge(getDb())); // 03:00 IST
