// Timer triggers. Schedules are UTC (NCRONTAB with seconds); IST = UTC+5:30.
import { app, type InvocationContext } from '@azure/functions';
import { getDb } from '../db/client';
import { expireLicences, purge, snapshotDailyStats } from '../lib/jobs';
import { onboardingExpiry, onboardingReminders, payoutCheck } from '../lib/growth/merchants';
import { expireUnconfirmed, expireUnpaid } from '../lib/orders';
import { drainOutbox } from '../lib/push';

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
// Orders whose ₹30 fee was never paid are cancelled after UNPAID_ORDER_TTL_MINUTES.
timer('unpaidExpiry', '0 */10 * * * *', () => expireUnpaid(getDb()));
// Backstop for notifications a request queued but could not send.
timer('pushOutbox', '30 * * * * *', () => drainOutbox(getDb()));
timer('licenceExpiry', '0 0 * * * *', () => expireLicences(getDb()));
timer('dailyStats', '0 25 18 * * *', () => snapshotDailyStats(getDb())); // 23:55 IST
timer('purge', '0 30 21 * * *', () => purge(getDb())); // 03:00 IST
// Growth program: approved + paid shops whose licence is verified go live and pay the agent
// (also done at once on licence verification); stale review links and drafts close.
timer('payoutCheck', '0 20 * * * *', () => payoutCheck(getDb()));
timer('onboardingExpiry', '0 40 * * * *', () => onboardingExpiry(getDb()));
timer('onboardingReminders', '0 45 * * * *', () => onboardingReminders(getDb()));
