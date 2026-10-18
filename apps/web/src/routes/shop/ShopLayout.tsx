import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ShopContext } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { Badge, Select, Spinner, cx } from '../../components/ui';
import { useAdminShops, useShopContext, useShopScope } from '../../lib/queries';

type ShopRole = ShopContext['role'];
const OWNER: ShopRole[] = ['shop_owner', 'admin'];

/** Each shop role sees only its own screens (SPEC_V3 §3); the API checks again. */
const tabs: { to: string; key: string; end: boolean; roles: ShopRole[] }[] = [
  { to: '/shop', key: 'orders', end: true, roles: [...OWNER, 'shop_staff'] },
  {
    to: '/shop/packing',
    key: 'packing',
    end: false,
    roles: [...OWNER, 'shop_staff', 'shop_packer'],
  },
  {
    to: '/shop/counter',
    key: 'counter',
    end: false,
    roles: [...OWNER, 'shop_staff', 'shop_cashier'],
  },
  { to: '/shop/prices', key: 'prices', end: false, roles: [...OWNER, 'shop_staff', 'shop_packer'] },
  { to: '/shop/hours', key: 'hours', end: false, roles: OWNER },
  { to: '/shop/payments', key: 'payments', end: false, roles: OWNER },
  { to: '/shop/licence', key: 'licence', end: false, roles: OWNER },
  { to: '/shop/report', key: 'report', end: false, roles: OWNER },
];

function AdminShopPicker() {
  const { t } = useTranslation();
  const scope = useShopScope();
  const shops = useAdminShops(scope.isAdmin);
  if (!scope.isAdmin) return null;
  return (
    <label className="flex items-center gap-2 text-sm font-semibold">
      <span className="text-muted">{t('shopApp.viewing')}</span>
      <Select
        value={scope.code}
        onChange={(e) => scope.choose(e.target.value)}
        className="mt-0 min-h-11 w-auto"
        aria-label={t('shopApp.viewing')}
      >
        <option value="">{t('shopApp.firstShop')}</option>
        {shops.data?.map((s) => (
          <option key={s.id} value={s.shortCode}>
            {s.name} ({s.shortCode})
          </option>
        ))}
      </Select>
    </label>
  );
}

export function ShopLayout() {
  const { t } = useTranslation();
  const ctx = useShopContext();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.18em] text-gold-deep uppercase">
            {t('shopApp.eyebrow')}
          </p>
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">
            {ctx.data?.name ?? t('nav.shop')}
          </h1>
          {ctx.data && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="plum">{ctx.data.shopCode}</Badge>
              <Badge tone={ctx.data.visible ? 'emerald' : 'danger'}>
                {ctx.data.visible ? t('shopApp.listed') : t('shopApp.hidden')}
              </Badge>
              {ctx.data.cluster && <Badge tone="muted">{ctx.data.cluster.name}</Badge>}
              {ctx.data.role !== 'shop_owner' && ctx.data.role !== 'admin' && (
                <Badge tone="gold">{t(`roles.${ctx.data.role}`)}</Badge>
              )}
            </div>
          )}
        </div>
        <AdminShopPicker />
      </div>

      <nav
        aria-label={t('shopApp.sections')}
        className="no-print mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-white p-1.5 shadow-[var(--shadow-card)]"
      >
        {tabs
          .filter((tab) => ctx.data && tab.roles.includes(ctx.data.role))
          .map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cx(
                  'flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-semibold transition',
                  isActive ? 'bg-plum text-white' : 'text-muted hover:bg-sand hover:text-ink',
                )
              }
            >
              {t(`shopApp.tabs.${tab.key}`)}
            </NavLink>
          ))}
      </nav>

      {ctx.isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={ctx.error} />
      {ctx.data && !ctx.data.visible && ctx.data.canEdit && (
        <p className="mb-5 rounded-2xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          {t('shopApp.hiddenHelp')}
        </p>
      )}
      {ctx.data && <Outlet />}
    </div>
  );
}
