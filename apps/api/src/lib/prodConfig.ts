// Production readiness: the settings a live deployment must have. /api/health reports
// config:false (503) until every one is right, so a deploy with a missing secret fails its
// smoke check instead of failing on the first customer. Only setting names are logged.
import { env } from './env';

const NOT_SET = new Set(['', 'not-set']);
const value = (name: string) => process.env[name] ?? '';
const missing = (name: string) => NOT_SET.has(value(name));

/** Names of the problems found; empty outside production or when everything is set. */
export function productionProblems(): string[] {
  if (!env.isProd()) return [];
  const problems: string[] = [];
  if (value('DEMO_MODE') === 'true') problems.push('DEMO_MODE must be false');
  if (value('OTP_DEV_MODE') === 'true') problems.push('OTP_DEV_MODE must be false');
  for (const name of ['DATABASE_URL', 'STORAGE_ACCOUNT_NAME', 'SEASON_END'])
    if (missing(name)) problems.push(`${name} is not set`);
  if (value('JWT_SECRET').length < 32) problems.push('JWT_SECRET needs at least 32 characters');
  if (value('MERCHANT_SECRETS_KEY').length < 32)
    problems.push('MERCHANT_SECRETS_KEY needs at least 32 characters');
  if (!/^https:\/\//.test(value('PUBLIC_ORIGIN'))) problems.push('PUBLIC_ORIGIN must be https://…');
  if (missing('MSG91_AUTH_KEY') || missing('MSG91_TEMPLATE_ID'))
    problems.push('MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are needed to send sign-in codes');
  const provider = value('PAYMENT_PROVIDER');
  if (provider !== 'razorpay') {
    problems.push('PAYMENT_PROVIDER must be razorpay');
  } else {
    try {
      env.razorpay();
    } catch (err) {
      problems.push((err as Error).message);
    }
  }
  return problems;
}

let logged = false;
/** True when production is fully configured; logs the problems once per instance. */
export function productionReady(): boolean {
  const problems = productionProblems();
  if (problems.length && !logged) {
    logged = true;
    console.error(`[config] production is not ready: ${problems.join('; ')}`);
  }
  return problems.length === 0;
}
