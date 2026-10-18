import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { homePathForRole, normalizeIndianPhone } from '@pataka/shared';
import { safeNextPath, useMe, useRequestOtp, useVerifyOtp } from '../auth/useAuth';
import { DiyaMark } from '../components/Brand';
import { DemoAccountList, pickHighlights } from '../components/DemoSwitcher';
import { ErrorText } from '../components/ErrorText';
import { Button, Card, Field, Input } from '../components/ui';
import { useDemoInfo } from '../lib/queries';

/** Phone → OTP → consent (SPEC §9 screen 5). Demo mode adds one-tap accounts. */
export function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const { data: me } = useMe();
  const { data: demo } = useDemoInfo();

  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [phoneError, setPhoneError] = useState(false);
  const requestOtp = useRequestOtp();
  const verifyOtp = useVerifyOtp();

  if (me && !verifyOtp.isSuccess) return <Navigate to={next ?? homePathForRole(me.role)} replace />;

  const sendCode = (e: FormEvent) => {
    e.preventDefault();
    const e164 = normalizeIndianPhone(phoneInput);
    setPhoneError(!e164);
    if (!e164) return;
    requestOtp.mutate(e164, { onSuccess: () => setPhone(e164) });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    verifyOtp.mutate(
      { phone, code },
      { onSuccess: (m) => navigate(next ?? homePathForRole(m.role), { replace: true }) },
    );
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_1.1fr]">
      <Card className="p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-night">
            <DiyaMark />
          </span>
          <div>
            <h1 className="text-2xl font-semibold">{t('auth.title')}</h1>
            <p className="text-sm text-muted">{t('auth.subtitle')}</p>
          </div>
        </div>

        {!phone ? (
          <form onSubmit={sendCode} className="space-y-4" noValidate>
            <Field label={t('auth.phoneLabel')}>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-4 mt-0.75 -translate-y-1/2 font-semibold text-muted">
                  +91
                </span>
                <Input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  aria-invalid={phoneError}
                  className="pl-14 text-lg tracking-wide"
                />
              </div>
            </Field>
            {phoneError && (
              <p role="alert" className="text-sm text-danger">
                {t('auth.phoneInvalid')}
              </p>
            )}
            <ErrorText error={requestOtp.error} />
            <Button size="lg" className="w-full" disabled={requestOtp.isPending}>
              {t('auth.sendCode')}
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <p className="text-sm text-muted">{t('auth.codeSent', { phone })}</p>
            <Field label={t('auth.codeLabel')}>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="text-center font-mono text-2xl tracking-[0.5em]"
              />
            </Field>
            <label className="flex items-start gap-3 rounded-2xl bg-sand/60 p-4 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-plum"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>{t('auth.consent')}</span>
            </label>
            <ErrorText error={verifyOtp.error} />
            <Button
              size="lg"
              className="w-full"
              disabled={code.length !== 6 || !consent || verifyOtp.isPending}
            >
              {t('auth.verify')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setPhone(null);
                setCode('');
                verifyOtp.reset();
              }}
            >
              {t('auth.changeNumber')}
            </Button>
          </form>
        )}
      </Card>

      {demo?.enabled && (
        <Card className="night-sky border-0 p-6 text-white sm:p-8">
          <p className="text-xs font-bold tracking-[0.18em] text-gold-light uppercase">
            {t('demo.pill')}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-white">{t('demo.loginTitle')}</h2>
          <p className="mt-2 mb-5 text-sm text-white/75">{t('demo.loginBody')}</p>
          <DemoAccountList accounts={pickHighlights(demo.accounts)} navigateAfter={false} />
        </Card>
      )}
    </div>
  );
}
