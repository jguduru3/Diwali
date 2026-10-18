import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { decodePlan, type GateCheckinResult } from '@pataka/shared';
import { QrScanner } from '../../components/QrScanner';
import { StatusChip } from '../../components/StatusChip';
import { Button, Select, Spinner, cx } from '../../components/ui';
import { ApiRequestError } from '../../lib/api';
import { slotRange, timeIST } from '../../lib/format';
import { useAdminClusters, useCheckin, useClusterScope, useGateToday } from '../../lib/queries';

type Outcome =
  { ok: true; result: GateCheckinResult } | { ok: false; code: string; message: string };

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

/** Gate (cluster marshal): scan slot QR → validate → send to a bay. */
export function Gate() {
  const { t } = useTranslation();
  const today = useGateToday();
  const checkin = useCheckin();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const onScan = (text: string) => {
    const decoded = decodePlan(text);
    const code = decoded.ok ? decoded.value.visitCode : text.trim().toUpperCase();
    if (!code) {
      setOutcome({ ok: false, code: 'walk_in', message: t('gate.walkInQr') });
      return;
    }
    checkin.mutate(
      { code },
      {
        onSuccess: (result) => setOutcome({ ok: true, result }),
        onError: (e) =>
          setOutcome({
            ok: false,
            code: e instanceof ApiRequestError ? e.code : 'generic',
            message: e instanceof ApiRequestError ? e.message : t('errors.generic'),
          }),
      },
    );
  };

  const data = today.data;
  const inUse = new Map(data?.baysInUse.map((b) => [b.bayNo, b]));
  const waiting = data?.visits.filter((v) => v.status === 'booked').length ?? 0;
  const arrived = data?.visits.filter((v) => v.status === 'arrived').length ?? 0;

  return (
    <div className="night-sky -mx-4 -my-6 min-h-[80vh] px-4 py-8 text-white sm:-mx-6 sm:-my-10 sm:rounded-none sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-gold-light uppercase">
              {t('gate.eyebrow')}
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-white sm:text-4xl">
              {data?.cluster.name ?? t('nav.gate')}
            </h1>
            {data && (
              <p className="mt-1 text-white/70">
                {t('gate.counts', {
                  waiting,
                  arrived,
                  free: data.cluster.bayCount - data.baysInUse.length,
                  total: data.cluster.bayCount,
                })}
              </p>
            )}
          </div>
          <ClusterPicker />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <section className="space-y-5">
            {outcome && (
              <div
                role="status"
                className={cx(
                  'rounded-[2rem] p-6 shadow-[var(--shadow-lift)]',
                  outcome.ok ? 'bg-emerald text-white' : 'bg-danger text-white',
                )}
              >
                {outcome.ok ? (
                  <>
                    <p className="text-sm font-bold tracking-widest uppercase opacity-80">
                      {t('gate.valid')}
                    </p>
                    <p className="mt-1 font-display text-5xl font-semibold sm:text-6xl">
                      {t('gate.sendToBay', { n: outcome.result.bayNo })}
                    </p>
                    <p className="mt-2 text-lg">
                      {outcome.result.shop.name} ·{' '}
                      {slotRange(outcome.result.slot.startsAt, outcome.result.slot.endsAt)}
                      {outcome.result.vehicle && ` · ${t(`vehicle.${outcome.result.vehicle}`)}`}
                    </p>
                    <p className="mt-1 font-mono tracking-widest opacity-80">
                      {outcome.result.code}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold tracking-widest uppercase opacity-80">
                      {t('gate.stop')}
                    </p>
                    <p className="mt-1 font-display text-3xl font-semibold">
                      {t(`gate.reasons.${outcome.code}`, { defaultValue: outcome.message })}
                    </p>
                    <p className="mt-2 text-white/85">{outcome.message}</p>
                  </>
                )}
                <Button variant="secondary" className="mt-5" onClick={() => setOutcome(null)}>
                  {t('gate.next')}
                </Button>
              </div>
            )}
            {!outcome && (
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur">
                <QrScanner
                  dark
                  busy={checkin.isPending}
                  onResult={onScan}
                  manualLabel={t('gate.manual')}
                  manualPlaceholder={t('gate.manualPlaceholder')}
                />
              </div>
            )}
          </section>

          <section className="space-y-5">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5">
              <h2 className="mb-3 text-lg font-semibold text-white">{t('gate.bays')}</h2>
              {today.isPending && <Spinner label={t('common.loading')} />}
              <ul className="grid grid-cols-5 gap-2 sm:grid-cols-6">
                {Array.from({ length: data?.cluster.bayCount ?? 0 }, (_, i) => i + 1).map((n) => {
                  const b = inUse.get(n);
                  return (
                    <li
                      key={n}
                      title={b ? `${b.code} · ${b.shopName}` : t('gate.free')}
                      className={cx(
                        'grid aspect-square place-items-center rounded-xl text-sm font-bold',
                        b ? 'bg-gold text-night' : 'bg-white/10 text-white/60',
                      )}
                    >
                      {n}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="rounded-[2rem] border border-white/10 bg-white p-5 text-ink">
              <h2 className="mb-3 text-lg font-semibold">{t('gate.today')}</h2>
              {data?.visits.length === 0 && (
                <p className="text-sm text-muted">{t('gate.noneToday')}</p>
              )}
              <ul className="max-h-[28rem] divide-y divide-line/70 overflow-y-auto">
                {data?.visits.map((v) => (
                  <li key={v.code} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                    <span className="w-16 font-semibold">{timeIST(v.slotStartsAt)}</span>
                    <span className="font-mono font-bold tracking-wider text-plum">{v.code}</span>
                    <StatusChip status={v.status} bayNo={v.bayNo} />
                    <span className="ml-auto truncate text-muted">{v.shopName}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
