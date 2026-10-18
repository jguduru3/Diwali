import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageTitle, cx } from '../../components/ui';

const tabs = ['', 'licences', 'shops', 'clusters', 'categories', 'team', 'blocked'] as const;

export function AdminLayout() {
  const { t } = useTranslation();
  return (
    <div>
      <PageTitle
        eyebrow={t('admin.eyebrow')}
        title={t('admin.title')}
        subtitle={t('admin.subtitle')}
      />
      <nav
        aria-label={t('admin.sections')}
        className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-white p-1.5 shadow-[var(--shadow-card)]"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab}
            to={tab ? `/admin/${tab}` : '/admin'}
            end={!tab}
            className={({ isActive }) =>
              cx(
                'flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-semibold transition',
                isActive ? 'bg-plum text-white' : 'text-muted hover:bg-sand hover:text-ink',
              )
            }
          >
            {t(`admin.tabs.${tab || 'overview'}`)}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
