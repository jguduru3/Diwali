import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { Button, Card, Field, Input, Notice, Segmented, Spinner, cx } from '../../components/ui';
import { dateTab, timeIST } from '../../lib/format';
import {
  useOwnSlots,
  useSaveDaySlots,
  useSaveSettings,
  useShopContext,
  useSlotCapacity,
} from '../../lib/queries';

function DefaultsCard() {
  const { t } = useTranslation();
  const ctx = useShopContext();
  const save = useSaveSettings();
  const [openFrom, setFrom] = useState('10:00');
  const [openTo, setTo] = useState('22:00');
  const [cap, setCap] = useState(10);
  useEffect(() => {
    if (!ctx.data) return;
    setFrom(ctx.data.openFrom ?? '10:00');
    setTo(ctx.data.openTo ?? '22:00');
    setCap(ctx.data.defaultCapacityPerSlot);
  }, [ctx.data]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ openFrom, openTo, defaultCapacityPerSlot: cap });
  };
  return (
    <Card className="p-6">
      <h2 className="text-xl font-semibold">{t('slots.defaultsTitle')}</h2>
      <p className="mt-1 mb-4 text-sm text-muted">{t('slots.defaultsBody')}</p>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-4 sm:items-end">
        <Field label={t('slots.opens')}>
          <Input type="time" required value={openFrom} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('slots.closes')}>
          <Input type="time" required value={openTo} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t('slots.perSlot')}>
          <Input
            type="number"
            min={1}
            max={200}
            required
            value={cap}
            onChange={(e) => setCap(Number(e.target.value))}
          />
        </Field>
        <Button disabled={save.isPending}>{t('common.save')}</Button>
      </form>
      <ErrorText error={save.error} />
      {save.isSuccess && (
        <Notice tone="emerald" className="mt-3">
          {t('slots.saved')}
        </Notice>
      )}
    </Card>
  );
}

function SlotCapacity({ id, capacity, booked }: { id: string; capacity: number; booked: number }) {
  const { t } = useTranslation();
  const patch = useSlotCapacity();
  const set = (n: number) => patch.mutate({ id, capacity: Math.max(booked, n) });
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        aria-label={t('slots.less')}
        disabled={capacity <= booked || patch.isPending}
        onClick={() => set(capacity - 1)}
      >
        −
      </Button>
      <span className="w-8 text-center font-semibold">{capacity}</span>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t('slots.more')}
        disabled={patch.isPending}
        onClick={() => set(capacity + 1)}
      >
        +
      </Button>
    </span>
  );
}

/** Owner: hours + capacity per 30 min per date. Booked places are never removed. */
export function Slots() {
  const { t } = useTranslation();
  const [date, setDate] = useState<string | undefined>();
  const slots = useOwnSlots(date);
  const saveDay = useSaveDaySlots();
  const [from, setFrom] = useState('10:00');
  const [to, setTo] = useState('22:00');
  const [cap, setCap] = useState(10);
  const active = date ?? slots.data?.date;

  return (
    <div className="space-y-6">
      <DefaultsCard />
      <Card className="p-6">
        <h2 className="text-xl font-semibold">{t('slots.dayTitle')}</h2>
        <p className="mt-1 mb-4 text-sm text-muted">{t('slots.dayBody')}</p>
        <Segmented
          label={t('book.date')}
          value={active ?? ''}
          onChange={setDate}
          options={(slots.data?.dates ?? []).slice(0, 10).map((d) => ({ value: d, ...dateTab(d) }))}
        />
        <form
          className="mt-5 grid gap-4 sm:grid-cols-4 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (active) saveDay.mutate({ date: active, openFrom: from, openTo: to, capacity: cap });
          }}
        >
          <Field label={t('slots.opens')}>
            <Input type="time" required value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('slots.closes')}>
            <Input type="time" required value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label={t('slots.perSlot')}>
            <Input
              type="number"
              min={1}
              max={200}
              value={cap}
              onChange={(e) => setCap(Number(e.target.value))}
            />
          </Field>
          <Button variant="dark" disabled={saveDay.isPending}>
            {t('slots.applyDay')}
          </Button>
        </form>
        <ErrorText error={saveDay.error} />

        {slots.isPending && <Spinner label={t('common.loading')} />}
        <ul className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {slots.data?.slots.map((s) => {
            const pct = s.capacity ? Math.min(100, (s.booked / s.capacity) * 100) : 100;
            return (
              <li key={s.id} className="rounded-2xl border border-line bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{timeIST(s.startsAt)}</span>
                  <SlotCapacity id={s.id} capacity={s.capacity} booked={s.booked} />
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sand">
                  <div
                    className={cx('h-full rounded-full', pct >= 100 ? 'bg-rose' : 'bg-gold')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {t('shopApp.capacity', { booked: s.booked, capacity: s.capacity })}
                </p>
              </li>
            );
          })}
        </ul>
        {slots.data?.slots.length === 0 && <Notice className="mt-4">{t('slots.closedDay')}</Notice>}
      </Card>
    </div>
  );
}
