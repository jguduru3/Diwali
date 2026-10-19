// Production configuration check (run at start-up). Errors stop the app in prod
// so a half-configured deployment fails its smoke test instead of serving.
type Vars = Record<string, string | undefined>;

export type ConfigReport = { errors: string[]; warnings: string[] };

const set = (v: string | undefined) => !!v && v !== 'not-set';

export function checkConfig(vars: Vars = process.env): ConfigReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (vars.APP_ENV !== 'prod') return { errors, warnings };

  if (!set(vars.DATABASE_URL)) errors.push('DATABASE_URL is not set');
  if ((vars.JWT_SECRET ?? '').length < 32) errors.push('JWT_SECRET must be at least 32 characters');
  if ((vars.MERCHANT_SECRETS_KEY ?? '').length < 32)
    errors.push('MERCHANT_SECRETS_KEY must be at least 32 characters');
  if (!set(vars.MSG91_AUTH_KEY) || !set(vars.MSG91_TEMPLATE_ID))
    errors.push('MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are needed to send sign-in codes');
  if (vars.DEMO_MODE === 'true') errors.push('DEMO_MODE must not be on in prod');
  if (vars.OTP_DEV_MODE === 'true') errors.push('OTP_DEV_MODE must not be on in prod');
  if (vars.COOKIE_SECURE === 'false') errors.push('COOKIE_SECURE must not be false in prod');
  if (vars.DATABASE_SSL === 'false') errors.push('DATABASE_SSL must not be false in prod');

  // L1 + G3: ordering in prod needs a real fee provider; the mock is test-only.
  const provider = vars.PAYMENT_PROVIDER || 'mock';
  if (vars.ORDERING_ENABLED === 'true' && provider === 'mock')
    errors.push('ORDERING_ENABLED needs a real PAYMENT_PROVIDER (the mock is not allowed in prod)');
  if (vars.ORDERING_ENABLED !== 'true')
    warnings.push(
      'Online ordering is off (ORDERING_ENABLED): shops show prices and walk-in lists only',
    );

  if (!(vars.PUBLIC_ORIGIN ?? '').startsWith('https://'))
    warnings.push('PUBLIC_ORIGIN is not an https URL: merchant webhook links cannot be shown');
  if (!set(vars.VAPID_PUBLIC_KEY) || !set(vars.VAPID_PRIVATE_KEY))
    warnings.push('VAPID keys are not set: push notifications are off');
  return { errors, warnings };
}

/** Logs the report; throws in prod when something required is missing. */
export function assertConfig(log: (msg: string) => void = console.warn, vars: Vars = process.env) {
  const { errors, warnings } = checkConfig(vars);
  for (const w of warnings) log(`config warning: ${w}`);
  if (errors.length) throw new Error(`Configuration errors:\n- ${errors.join('\n- ')}`);
}
