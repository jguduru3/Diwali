import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { VENDOR_ROLES, type Role } from '@pataka/shared';
import { useMe } from '../auth/useAuth';
import { Button } from './ui';

type Audience = 'customer' | 'merchant';

const FLOW = ['order', 'confirm', 'pack', 'pickup'] as const;
const MERCHANT_FACTS = ['payShop', 'pickupOnly', 'noCommission', 'licensed', 'privacy'] as const;

/** Remembered on this phone, per audience, so each sees its explainer once. */
const seenKey = (a: Audience) => `pp.howSeen.${a}`;

function seen(a: Audience): boolean {
  try {
    return localStorage.getItem(seenKey(a)) === '1';
  } catch {
    return true; // storage blocked: never nag on every visit
  }
}

function audienceFor(role: Role | undefined, pathname: string): Audience | null {
  // Customers and visitors on the shop list; shop roles in the merchant area.
  if ((!role || role === 'customer') && pathname === '/') return 'customer';
  if (role && (VENDOR_ROLES as readonly string[]).includes(role) && pathname.startsWith('/shop'))
    return 'merchant';
  return null;
}

/**
 * "How it works" on first access: customers see an order step by step, shop staff see how the
 * platform treats their shop. A sheet over the page, closed with one tap, shown once per phone.
 */
export function FirstRunHowItWorks() {
  const { pathname } = useLocation();
  const { data: me, isPending } = useMe();
  const audience = isPending ? null : audienceFor(me?.role, pathname);
  const [open, setOpen] = useState<Audience | null>(null);

  useEffect(() => {
    if (audience && !seen(audience)) setOpen(audience);
  }, [audience]);

  if (!open) return null;
  return <Sheet audience={open} onDone={() => setOpen(null)} />;
}

function Sheet({ audience, onDone }: { audience: Audience; onDone: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d?.showModal) d.showModal();
    else d?.setAttribute('open', '');
  }, []);
  const finish = () => {
    try {
      localStorage.setItem(seenKey(audience), '1');
    } catch {
      // storage unavailable: it closes for this visit
    }
    if (ref.current?.close) ref.current.close();
    onDone();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="how-title"
      onCancel={finish}
      className="mx-auto mt-auto mb-0 max-h-[90dvh] w-full max-w-none animate-pop-in overflow-y-auto rounded-t-3xl border border-line bg-white p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-night/45 sm:m-auto sm:max-w-2xl sm:rounded-3xl"
    >
      <div className="px-5 pt-6 pb-4 sm:px-8 sm:pt-8">
        <p className="text-xs font-bold tracking-[0.14em] text-gold-deep uppercase">
          {t('about.eyebrow')}
        </p>
        <h2 id="how-title" className="mt-1 text-2xl font-extrabold sm:text-3xl">
          {audience === 'customer' ? t('about.flowTitle') : t('firstRun.merchantTitle')}
        </h2>

        {audience === 'customer' ? (
          <ol className="mt-5 grid gap-3 sm:grid-cols-2">
            {FLOW.map((f, i) => (
              <li key={f} className="flex gap-4 rounded-2xl bg-brand-050 p-4">
                <span className="font-display text-2xl font-extrabold text-gold-deep">
                  0{i + 1}
                </span>
                <span>
                  <span className="block font-bold">{t(`about.flow.${f}.title`)}</span>
                  <span className="mt-0.5 block text-sm text-muted">
                    {t(`about.flow.${f}.body`)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {MERCHANT_FACTS.map((f) => (
              <li key={f} className="rounded-2xl bg-brand-050 p-4">
                <span className="block font-bold">{t(`about.facts.${f}.title`)}</span>
                <span className="mt-0.5 block text-sm text-muted">
                  {t(`about.facts.${f}.body`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-line bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8">
        <Link
          to="/about"
          onClick={finish}
          className="text-sm font-semibold text-plum underline-offset-4 hover:underline"
        >
          {t('firstRun.more')}
        </Link>
        <Button type="button" onClick={finish} className="min-w-32">
          {t('firstRun.gotIt')}
        </Button>
      </div>
    </dialog>
  );
}
