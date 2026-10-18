import { useTranslation } from 'react-i18next';
import { QrScanner } from '../../components/QrScanner';
import { OrderStatusChip } from '../../components/OrderStatusChip';
import { Button, Select, cx } from '../../components/ui';
import { ApiRequestError } from '../../lib/api';
import { useAdminClusters, useClusterScope, useGateLookup } from '../../lib/queries';

function ClusterPicker() {
  const { t } = useTranslation();
  const scope = useClusterScope();
  const clusters = useAdminClusters(scope.isAdmin);
  if (!scope.isAdmin) return null;
  return (
    <Select
      value={scope.id}
      onChange={(e) => scope.choose(e.target.value)}
      aria-label={t('gate.cluster')}
      className="mt-0 min-h-11 w-auto border-white/20 bg-white/10 text-white"
    >
      <option value="" className="text-ink">
        {t('gate.firstCluster')}
      </option>
      {clusters.data?.map((c) => (
        <option key={c.id} value={c.id} className="text-ink">
          {c.name}
        </option>
      ))}
    </Select>
  );
}

/** Gate (ground marshal): scan a customer's pickup QR → which shop and pack to go to. */
export function Gate() {
  const { t, i18n } = useTranslation();
  const lookup = useGateLookup();
  const r = lookup.data;
  const err = lookup.error;
  const errCode = err instanceof ApiRequestError ? err.code : 'generic';

  return (
    <div className="night-sky -mx-4 -my-6 min-h-[80vh] px-4 py-8 text-white sm:-mx-6 sm:-my-10 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-gold-light uppercase">
              {t('gate.eyebrow')}
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-white sm:text-4xl">
              {t('gate.title')}
            </h1>
          </div>
          <ClusterPicker />
        </div>

        {r || err ? (
          <div
            role="status"
            className={cx(
              'rounded-[2rem] p-6 shadow-[var(--shadow-lift)]',
              r && r.sameGround ? 'bg-emerald text-white' : 'bg-danger text-white',
            )}
          >
            {r ? (
              <>
                <p className="font-display text-4xl font-semibold sm:text-5xl">
                  {t('gate.goTo', { shop: r.shopName })}
                </p>
                <p className="mt-2 text-lg">
                  {r.code}
                  {r.packNo && ` · ${t('order.packNo', { n: r.packNo })}`}
                </p>
                <div className="mt-2">
                  <OrderStatusChip status={r.status} staff />
                </div>
                {!r.sameGround && <p className="mt-3 font-semibold">{t('gate.otherGround')}</p>}
              </>
            ) : (
              <>
                <p className="text-sm font-bold tracking-widest uppercase opacity-80">
                  {t('gate.stop')}
                </p>
                <p className="mt-1 font-display text-3xl font-semibold">
                  {i18n.exists(`errors.${errCode}`) ? t(`errors.${errCode}`) : t('errors.generic')}
                </p>
              </>
            )}
            <Button variant="secondary" className="mt-5" onClick={() => lookup.reset()}>
              {t('gate.next')}
            </Button>
          </div>
        ) : (
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur">
            <QrScanner
              dark
              busy={lookup.isPending}
              onResult={(qr) => lookup.mutate(qr)}
              manualLabel={t('gate.manual')}
              manualPlaceholder={t('gate.manualPlaceholder')}
            />
          </div>
        )}
      </div>
    </div>
  );
}
