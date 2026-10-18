// Timer triggers. Schedules are UTC (NCRONTAB with seconds); IST = UTC+5:30.
import { app, type InvocationContext } from '@azure/functions';
import { getDb } from '../db/client';
import {
  expireLicences,
  generateUpcomingSlots,
  purge,
  snapshotDailyStats,
  sweepNoShows,
} from '../lib/jobs';

function timer(name: string, schedule: string, job: () => Promise<unknown>) {
  app.timer(name, {
    schedule,
    handler: async (_t, ctx: InvocationContext) => {
      const result = await job();
      ctx.log(`${name}: ${JSON.stringify(result)}`);
    },
  });
}

timer('noShowSweeper', '0 */5 * * * *', () => sweepNoShows(getDb()));
timer('licenceExpiry', '0 0 * * * *', () => expireLicences(getDb()));
timer('dailyStats', '0 25 18 * * *', () => snapshotDailyStats(getDb())); // 23:55 IST
timer('slotGenerator', '0 40 18 * * *', () => generateUpcomingSlots(getDb())); // 00:10 IST
timer('purge', '0 30 21 * * *', () => purge(getDb())); // 03:00 IST
