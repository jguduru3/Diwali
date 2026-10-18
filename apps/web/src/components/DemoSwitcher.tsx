import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  canAccessArea,
  homePathForRole,
  type Area,
  type DemoAccount,
  type Role,
} from '@pataka/shared';
import { useMe } from '../auth/useAuth';
import { useDemoInfo, useDemoLogin } from '../lib/queries';
import { Button, cx } from './ui';

const ROLE_ICON: Record<string, string> = {
  customer: '🪔',
  shop_owner: '🏪',
  shop_staff: '🧾',
  marshal: '🚦',
  admin: '✦',
};

/** One account per role is enough to explore; the rest stay in the full list. */
export function pickHighlights(accounts: DemoAccount[]): DemoAccount[] {
  const seen = new Set<string>();
  return accounts.filter((a) => (seen.has(a.role) ? false : (seen.add(a.role), true)));
}

export function DemoAccountList({
  accounts,
  onPicked,
  area,
  navigateAfter = true,
}: {
  accounts: DemoAccount[];
  onPicked?: (a: DemoAccount) => void;
  /** only accounts that can open this area */
  area?: Area;
  /** go to the account's home area after switching */
  navigateAfter?: boolean;
}) {
  const { t } = useTranslation();
  const login = useDemoLogin();
  const navigate = useNavigate();
  const list = area ? accounts.filter((a) => canAccessArea(a.role as Role, area)) : accounts;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {list.map((a) => (
        <li key={a.phone}>
          <button
            type="button"
            disabled={login.isPending}
            onClick={() =>
              login.mutate(a.phone, {
                onSuccess: (me) => {
                  onPicked?.(a);
                  if (!area && navigateAfter) navigate(homePathForRole(me.role));
                },
              })
            }
            className="group flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left transition hover:border-gold hover:shadow-[var(--shadow-card)] disabled:opacity-50"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sand text-xl group-hover:bg-gold-light/50">
              {ROLE_ICON[a.role] ?? '•'}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-ink">{t(`roles.${a.role}`)}</span>
              <span className="block truncate text-xs text-muted">
                {a.context ?? a.displayName}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Header pill: "Demo · viewing as …" with a quick account switcher. */
export function DemoSwitcher() {
  const { t } = useTranslation();
  const { data: demo } = useDemoInfo();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!demo?.enabled) return null;
  const shown = all ? demo.accounts : pickHighlights(demo.accounts);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 items-center gap-2 rounded-full border border-gold/50 bg-gold/15 px-3.5 text-sm font-semibold text-gold-light transition hover:bg-gold/25"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
        <span className="hidden sm:inline">{t('demo.pill')}</span>
        <span className="max-w-36 truncate text-white">
          {me ? t(`roles.${me.role}`) : t('demo.pick')}
        </span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="fixed inset-x-3 top-20 z-50 mx-auto max-h-[80vh] max-w-xl overflow-y-auto rounded-3xl border border-line bg-ivory p-4 text-ink shadow-[var(--shadow-lift)]">
          <p className="font-display text-lg font-semibold">{t('demo.title')}</p>
          <p className="mb-3 text-sm text-muted">{t('demo.body')}</p>
          <DemoAccountList accounts={shown} onPicked={() => setOpen(false)} />
          <div className="mt-3 flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
              {all ? t('demo.fewer') : t('demo.all', { count: demo.accounts.length })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DemoRibbon() {
  const { t } = useTranslation();
  const { data: demo } = useDemoInfo();
  if (!demo?.enabled) return null;
  return (
    <div
      className={cx(
        'bg-gradient-to-r from-saffron via-gold to-gold-light px-4 py-1.5 text-center text-xs font-bold text-night',
      )}
    >
      {t('demo.ribbon')}
    </div>
  );
}
