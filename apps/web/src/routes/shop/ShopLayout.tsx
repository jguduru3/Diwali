import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { Badge, Select, Spinner, cx } from '../../components/ui';
import { useAdminShops, useShopContext, useShopScope } from '../../lib/queries';

const tabs = [
  { to: '/shop', key: 'today', end: true, owner: false },
  { to: '/shop/counter', key: 'counter', end: false, owner: false },
  { to: '/shop/prices', key: 'prices', end: false, owner: false },
  { to: '/shop/slots', key: 'slots', end: false, owner: true },
  { to: '/shop/licence', key: 'licence', end: false, owner: true },
  { to: '/shop/report', key: 'report', end: false, owner: true },
] as const;

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
              {!ctx.data.canEdit && <Badge tone="gold">{t('roles.shop_staff')}</Badge>}
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
          .filter((tab) => !tab.owner || ctx.data?.canEdit)
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
