import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatPaise, type Vehicle } from '@pataka/shared';
import { useMe } from '../../auth/useAuth';
import { DemoAccountList } from '../../components/DemoSwitcher';
import { ErrorText } from '../../components/ErrorText';
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Notice,
  Segmented,
  Spinner,
  cx,
} from '../../components/ui';
import { dateTab, slotRange, timeIST } from '../../lib/format';
import { usePlan } from '../../lib/planList';
import {
  useBookVisit,
  useCurrentVisit,
  useDemoInfo,
  useShop,
  useShopItems,
  useShopSlots,
} from '../../lib/queries';
import { usePlanDetails } from './usePlanDetails';

/** SPEC §9 screen 4: date tabs, 30-min slots with places left, vehicle. */
export function BookPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const code = (useParams().code ?? '').toUpperCase();
  const { data: me } = useMe();
  const { data: demo } = useDemoInfo();
  const shop = useShop(code);
  const items = useShopItems(code);
  const plan = usePlan(code, items.data?.priceVersion);
  const { total } = usePlanDetails(plan.lines, items.data);
  const [date, setDate] = useState<string | undefined>();
  const slots = useShopSlots(code, date);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle>('car');
  const current = useCurrentVisit(!!me);
  const book = useBookVisit();

  const dates = (slots.data?.dates ?? []).slice(0, 8);
  const activeDate = date ?? slots.data?.date;
  const chosen = slots.data?.slots.find((s) => s.id === slotId);

  if (current.data) {
    return (
      <EmptyState
        icon="🎟"
        title={t('book.haveTicketTitle')}
        body={t('book.haveTicketBody', { shop: current.data.shop.name })}
        action={<ButtonLink to="/ticket">{t('book.openTicket')}</ButtonLink>}
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <section>
        <Link to={`/s/${code}/plan`} className="text-sm font-semibold text-plum hover:underline">
          ← {t('plan.title')}
        </Link>
        <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{t('book.title')}</h1>
        <p className="mt-1 text-muted">{t('book.subtitle', { shop: shop.data?.name ?? code })}</p>

        <div className="mt-6">
          <Segmented
            label={t('book.date')}
            value={activeDate ?? ''}
            onChange={(d) => {
              setDate(d);
              setSlotId(null);
            }}
            options={dates.map((d) => ({ value: d, ...dateTab(d) }))}
          />
        </div>

        {slots.isPending && <Spinner label={t('common.loading')} />}
        <ErrorText error={slots.error} />
        {slots.data &&
          !slots.data.slots.some((s) => new Date(s.startsAt).getTime() > Date.now()) && (
            <Notice className="mt-4">{t('book.noSlots')}</Notice>
          )}
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {slots.data?.slots
            .filter((s) => new Date(s.startsAt).getTime() > Date.now())
            .map((s) => {
              const active = s.id === slotId;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={!s.bookable}
                  onClick={() => setSlotId(s.id)}
                  aria-pressed={active}
                  className={cx(
                    'min-h-16 rounded-2xl border p-3 text-left transition',
                    active
                      ? 'border-plum bg-plum text-white shadow-[var(--shadow-card)]'
                      : 'border-line bg-white hover:border-plum/40',
                    !s.bookable &&
                      'cursor-not-allowed border-dashed bg-sand/40 text-muted opacity-70 hover:border-line',
                  )}
                >
                  <span className="block font-semibold">{timeIST(s.startsAt)}</span>
                  <span className={cx('text-xs', active ? 'text-gold-light' : 'text-muted')}>
                    {s.remaining === 0
                      ? t('book.full')
                      : !s.bookable
                        ? t('book.closedSlot')
                        : t('home.left', { count: s.remaining })}
                  </span>
                </button>
              );
            })}
        </div>

        <h2 className="mt-8 mb-3 text-xl font-semibold">{t('book.vehicle')}</h2>
        <Segmented<Vehicle>
          label={t('book.vehicle')}
          value={vehicle}
          onChange={setVehicle}
          options={[
            { value: 'car', label: `🚗 ${t('vehicle.car')}` },
            { value: 'bike', label: `🛵 ${t('vehicle.bike')}` },
            { value: 'walk', label: `🚶 ${t('vehicle.walk')}` },
          ]}
        />
      </section>

      <aside id="book-summary" className="scroll-mt-40 lg:sticky lg:top-40 lg:self-start">
        <Card className="p-6">
          <h2 className="text-xl font-semibold">{t('book.summary')}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{t('book.shop')}</dt>
              <dd className="text-right font-semibold">{shop.data?.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{t('book.slot')}</dt>
              <dd className="text-right font-semibold">
                {chosen
                  ? `${dateTab(activeDate!).label}, ${slotRange(chosen.startsAt, chosen.endsAt)}`
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{t('plan.title')}</dt>
              <dd className="text-right font-semibold">
                {plan.count
                  ? t('plan.summary', { count: plan.count, total: formatPaise(total) })
                  : t('book.noList')}
              </dd>
            </div>
          </dl>
          <Notice className="mt-5">{t('book.rules')}</Notice>

          <div className="mt-5">
            {me ? (
              <>
                <ErrorText error={book.error} />
                <Button
                  size="lg"
                  className="mt-3 w-full"
                  disabled={!slotId || book.isPending}
                  onClick={() =>
                    slotId &&
                    book.mutate(
                      { shopShortCode: code, slotId, vehicle },
                      { onSuccess: () => navigate('/ticket') },
                    )
                  }
                >
                  {book.isPending ? t('common.loading') : t('book.cta')}
                </Button>
              </>
            ) : demo?.enabled ? (
              <div>
                <p className="mb-3 text-sm font-semibold">{t('book.demoSignIn')}</p>
                <DemoAccountList
                  accounts={demo.accounts.filter((a) => a.role === 'customer').slice(0, 1)}
                  navigateAfter={false}
                />
              </div>
            ) : (
              <ButtonLink
                to={`/login?next=${encodeURIComponent(`/s/${code}/book`)}`}
                size="lg"
                className="w-full"
              >
                {t('book.signInToBook')}
              </ButtonLink>
            )}
          </div>
        </Card>
      </aside>
      {chosen && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-3 lg:hidden">
          <div className="night-sky flex items-center justify-between gap-3 rounded-3xl px-5 py-3 text-white shadow-[var(--shadow-lift)]">
            <p className="font-semibold">
              {dateTab(activeDate!).label}, {slotRange(chosen.startsAt, chosen.endsAt)}
            </p>
            <Button
              onClick={() =>
                document.getElementById('book-summary')?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              {t('book.continue')} ↓
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
