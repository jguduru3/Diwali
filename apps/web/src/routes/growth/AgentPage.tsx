import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isValidGstin, type MerchantDraft } from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { QrCode } from '../../components/QrCode';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  Input,
  Notice,
  PageTitle,
  Spinner,
} from '../../components/ui';
import { ApiRequestError } from '../../lib/api';
import {
  useAgentMe,
  useAgentRegister,
  useMerchantAction,
  useNewMerchant,
  useNotifications,
} from '../../lib/growth';
import { openShopSetup } from '../../lib/queries';
import { TermsCheck } from './TermsCheck';

const STEPS = ['draft', 'setup', 'review', 'approved', 'live'] as const;

/** Forward a link to the shop owner on WhatsApp (or copy it). */
export function ShareLink({ url, text }: { url: string; text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-10 items-center rounded-xl bg-emerald px-3 text-[13px] font-semibold text-white"
      >
        {t('agent.shareWhatsApp')}
      </a>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}
      >
        {copied ? t('agent.copied') : t('agent.copyLink')}
      </Button>
    </div>
  );
}

function Register() {
  const { t } = useTranslation();
  const reg = useAgentRegister();
  const [f, setF] = useState({
    name: '',
    upiId: '',
    recruitCode: localStorage.getItem('pp.recruit') ?? '',
  });
  const [terms, setTerms] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    reg.mutate({
      name: f.name.trim(),
      upiId: f.upiId.trim(),
      recruitCode: f.recruitCode.trim() || undefined,
      acceptTerms: terms as true,
    });
  };
  return (
    <Card className="mx-auto max-w-xl p-6 sm:p-8">
      <h2 className="text-xl font-bold">{t('agent.registerTitle')}</h2>
      <p className="mt-1 mb-5 text-sm text-muted">{t('agent.registerBody')}</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('agent.name')}>
          <Input
            required
            minLength={2}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field label={t('wallet.upiId')} hint={t('wallet.upiHint')}>
          <Input
            required
            value={f.upiId}
            onChange={(e) => setF({ ...f, upiId: e.target.value })}
            placeholder="name@bank" // i18n-ignore: format example
          />
        </Field>
        <Field label={t('agent.recruitCode')} hint={t('agent.recruitHint')}>
          <Input
            value={f.recruitCode}
            onChange={(e) => setF({ ...f, recruitCode: e.target.value.toUpperCase() })}
            placeholder="DXI-…" // i18n-ignore: format example
          />
        </Field>
        <TermsCheck party="agent" checked={terms} onChange={setTerms} />
        <ErrorText error={reg.error} />
        <Button disabled={!terms || reg.isPending}>{t('agent.register')}</Button>
      </form>
    </Card>
  );
}

function NewMerchantForm({ onDone }: { onDone: (d: MerchantDraft) => void }) {
  const { t } = useTranslation();
  const create = useNewMerchant();
  const [f, setF] = useState({ shopName: '', area: '', ownerName: '', ownerPhone: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Card className="p-5">
      <h3 className="text-lg font-bold">{t('agent.newMerchant')}</h3>
      <p className="mb-4 text-sm text-muted">{t('agent.newMerchantBody')}</p>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(f, { onSuccess: (d) => onDone(d) });
        }}
      >
        <Field label={t('agent.shopName')}>
          <Input required minLength={2} value={f.shopName} onChange={set('shopName')} />
        </Field>
        <Field label={t('agent.area')}>
          <Input required minLength={2} value={f.area} onChange={set('area')} />
        </Field>
        <Field label={t('agent.ownerName')}>
          <Input required minLength={2} value={f.ownerName} onChange={set('ownerName')} />
        </Field>
        <Field label={t('agent.ownerPhone')}>
          <Input
            required
            inputMode="tel"
            value={f.ownerPhone}
            onChange={set('ownerPhone')}
            placeholder="98765 43210"
          />
        </Field>
        <div className="space-y-3 sm:col-span-2">
          <ErrorText error={create.error} />
          {create.error instanceof ApiRequestError && create.error.code === 'owner_exists' && (
            <Notice tone="danger">{create.error.message}</Notice>
          )}
          <Button disabled={create.isPending}>{t('agent.sendConsent')}</Button>
        </div>
      </form>
    </Card>
  );
}

function Steps({ status }: { status: MerchantDraft['status'] }) {
  const { t } = useTranslation();
  const at = status === 'consented' ? 1 : STEPS.indexOf(status as (typeof STEPS)[number]);
  return (
    <ol className="flex flex-wrap gap-1" aria-label={t('agent.progress')}>
      {STEPS.map((s, i) => (
        <li
          key={s}
          className={
            i <= at && status !== 'closed'
              ? 'rounded bg-plum px-2 py-0.5 text-xs font-semibold text-white'
              : 'rounded bg-ivory px-2 py-0.5 text-xs font-semibold text-muted ring-1 ring-line'
          }
          aria-current={i === at ? 'step' : undefined}
        >
          {t(`agent.step.${s}`)}
        </li>
      ))}
    </ol>
  );
}

function SetupForm({ m }: { m: MerchantDraft }) {
  const { t } = useTranslation();
  const act = useMerchantAction();
  const [f, setF] = useState({
    gstin: '',
    address: '',
    openFrom: '09:00',
    openTo: '21:00',
    lat: '',
    lng: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const locate = () =>
    navigator.geolocation?.getCurrentPosition((p) =>
      setF((x) => ({
        ...x,
        lat: p.coords.latitude.toFixed(6),
        lng: p.coords.longitude.toFixed(6),
      })),
    );
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        if (f.gstin && !isValidGstin(f.gstin)) return setErr(t('documents.gstinInvalid'));
        act.mutate({
          id: m.id,
          action: 'setup',
          body: {
            ...(f.gstin ? { gstin: f.gstin.toUpperCase() } : {}),
            ...(f.address ? { address: f.address } : {}),
            openFrom: f.openFrom,
            openTo: f.openTo,
            ...(f.lat && f.lng ? { lat: Number(f.lat), lng: Number(f.lng) } : {}),
          },
        });
      }}
    >
      <Field label={t('documents.gstin')} hint={t('documents.gstinHint')}>
        <Input
          value={f.gstin}
          maxLength={15}
          onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })}
        />
      </Field>
      <Field label={t('agent.address')}>
        <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      </Field>
      <Field label={t('hours.opens')}>
        <Input
          type="time"
          value={f.openFrom}
          onChange={(e) => setF({ ...f, openFrom: e.target.value })}
        />
      </Field>
      <Field label={t('hours.closes')}>
        <Input
          type="time"
          value={f.openTo}
          onChange={(e) => setF({ ...f, openTo: e.target.value })}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
        <Button type="button" variant="secondary" size="sm" onClick={locate}>
          {t('agent.pinHere')}
        </Button>
        {f.lat && (
          <span className="text-sm text-muted tabular-nums">
            {f.lat}, {f.lng}
          </span>
        )}
      </div>
      <div className="space-y-2 sm:col-span-2">
        {err && <Notice tone="danger">{err}</Notice>}
        <ErrorText error={act.error} />
        <Button size="sm" disabled={act.isPending}>
          {t('agent.saveSetup')}
        </Button>
      </div>
    </form>
  );
}

function MerchantCard({ m, link }: { m: MerchantDraft; link?: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const act = useMerchantAction();
  const [code, setCode] = useState('');
  const [helped, setHelped] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const ownerLink = act.data?.ownerLink ?? link ?? m.ownerLink;
  const open = (path: string) => {
    openShopSetup(m.shopCode);
    navigate(path);
  };
  return (
    <Card as="li" className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{m.shopName}</h3>
          <p className="text-sm text-muted">
            {m.area} · {m.ownerName} · {m.ownerPhoneMasked} · {m.shopCode}
          </p>
        </div>
        {m.status === 'closed' ? (
          <Badge tone="danger">{t('agent.step.closed')}</Badge>
        ) : m.payout === 'credited' ? (
          <Badge tone="emerald">{t('agent.paid')}</Badge>
        ) : null}
      </div>
      <Steps status={m.status} />
      {m.note && <Notice>{t('agent.ownerNote', { note: m.note })}</Notice>}

      {m.status === 'draft' && (
        <div className="space-y-3">
          <p className="text-sm">{t('agent.consentHelp')}</p>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act.mutate({ id: m.id, action: 'consent', body: { code } });
            }}
          >
            <Input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-label={t('agent.consentCode')}
              placeholder="••••••"
              className="mt-0 w-36 tracking-[0.3em]"
            />
            <Button disabled={code.length !== 6 || act.isPending}>
              {t('agent.confirmConsent')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => act.mutate({ id: m.id, action: 'resend' })}
            >
              {t('agent.resend')}
            </Button>
          </form>
          {ownerLink && (
            <ShareLink url={ownerLink} text={t('agent.consentMessage', { shop: m.shopName })} />
          )}
        </div>
      )}

      {m.status === 'setup' && (
        <div className="space-y-4">
          <div>
            <p className="text-[13px] font-semibold text-muted">{t('agent.stillMissing')}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {['licence', 'gstin', 'hours', 'map', 'products'].map((k) => (
                <li key={k}>
                  <Badge tone={m.missing.includes(k) ? 'saffron' : 'emerald'}>
                    {m.missing.includes(k) ? '○' : '✓'} {t(`agent.need.${k}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => open('/shop/prices')}>
              {t('agent.openProducts')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => open('/shop/licence')}>
              {t('agent.openLicence')}
            </Button>
          </div>
          <SetupForm m={m} />
          <Button
            disabled={m.missing.length > 0 || act.isPending}
            onClick={() => act.mutate({ id: m.id, action: 'submit' })}
          >
            {t('agent.submit')}
          </Button>
        </div>
      )}

      {m.status === 'review' && (
        <div className="space-y-2">
          <p className="text-sm">{t('agent.waitingOwner')}</p>
          {ownerLink && (
            <ShareLink url={ownerLink} text={t('agent.reviewMessage', { shop: m.shopName })} />
          )}
        </div>
      )}
      {m.status === 'approved' && <Notice>{t('agent.waitingLicence')}</Notice>}

      {m.status === 'live' && !m.feedbackGiven && (
        <form
          className="space-y-3 rounded-xl border border-line bg-ivory p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (helped !== null)
              act.mutate({
                id: m.id,
                action: 'feedback',
                body: { helped, note: note || undefined },
              });
          }}
        >
          <p className="font-semibold">{t('agent.feedbackQuestion')}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={helped === true ? 'primary' : 'secondary'}
              onClick={() => setHelped(true)}
            >
              {t('agent.yes')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={helped === false ? 'primary' : 'secondary'}
              onClick={() => setHelped(false)}
            >
              {t('agent.no')}
            </Button>
          </div>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={t('agent.feedbackNote')}
            placeholder={t('agent.feedbackNote')}
            className="mt-0"
          />
          <Button size="sm" disabled={helped === null}>
            {t('agent.sendFeedback')}
          </Button>
        </form>
      )}
      <ErrorText error={act.error} />
    </Card>
  );
}

/** Agent portal: code, merchants and each one's steps; money is in the wallet. */
export function AgentPage() {
  const { t } = useTranslation();
  // An influencer's agent link (/agent?recruit=DXI-…) pre-fills the code on registration.
  const [params] = useSearchParams();
  useEffect(() => {
    const code = params.get('recruit');
    if (code) localStorage.setItem('pp.recruit', code.toUpperCase());
  }, [params]);
  const me = useAgentMe();
  const notes = useNotifications();
  const [links, setLinks] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  // A link is known only in the response that made it; keep it for this visit.
  const remember = (d: MerchantDraft) => {
    if (d.ownerLink) setLinks((l) => ({ ...l, [d.id]: d.ownerLink! }));
  };

  if (me.isPending) return <Spinner label={t('common.loading')} />;
  const notAgent = me.error instanceof ApiRequestError && me.error.code === 'not_agent';
  return (
    <div className="space-y-6">
      <PageTitle
        eyebrow={t('agent.eyebrow')}
        title={t('agent.title')}
        subtitle={t('agent.subtitle')}
      />
      {notAgent ? (
        <Register />
      ) : me.error ? (
        <ErrorText error={me.error} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
            <Card className="flex items-center gap-4 p-5">
              <QrCode text={me.data!.code} label={me.data!.code} className="h-28 w-28" />
              <div>
                <p className="text-[13px] font-semibold text-muted">{t('agent.yourCode')}</p>
                <p className="text-2xl font-extrabold tracking-wide">{me.data!.code}</p>
                <Badge tone={me.data!.status === 'active' ? 'emerald' : 'gold'}>
                  {t(`agent.status.${me.data!.status}`)}
                </Badge>
              </div>
            </Card>
            <Card className="space-y-3 p-5">
              <p className="text-sm">{t('agent.howPaid')}</p>
              <div className="flex flex-wrap gap-2">
                <ButtonLink to="/wallet" variant="secondary" size="sm">
                  {t('agent.openWallet')}
                </ButtonLink>
                <ButtonLink to="/terms/agent" variant="ghost" size="sm">
                  {t('agent.rules')}
                </ButtonLink>
              </div>
              {me.data!.status === 'pending' && <Notice>{t('agent.pendingNote')}</Notice>}
              {me.data!.status === 'suspended' && (
                <Notice tone="danger">{t('agent.suspendedNote')}</Notice>
              )}
            </Card>
          </div>

          {me.data!.status === 'active' &&
            (adding ? (
              <NewMerchantForm
                onDone={(d) => {
                  remember(d);
                  setAdding(false);
                }}
              />
            ) : (
              <Button onClick={() => setAdding(true)}>+ {t('agent.newMerchant')}</Button>
            ))}

          {me.data!.merchants.length === 0 ? (
            <EmptyState title={t('agent.noMerchants')} body={t('agent.noMerchantsBody')} />
          ) : (
            <ul className="grid gap-4 xl:grid-cols-2">
              {me.data!.merchants.map((m) => (
                <MerchantCard key={m.id} m={m} link={links[m.id]} />
              ))}
            </ul>
          )}

          {!!notes.data?.length && (
            <section>
              <h2 className="mb-2 text-lg font-bold">{t('agent.notifications')}</h2>
              <ul className="space-y-2">
                {notes.data.slice(0, 10).map((n) => (
                  <li
                    key={n.id}
                    className="rounded-xl border border-line bg-white px-4 py-3 text-sm"
                  >
                    {t(`notice.${n.type}`, n.params ?? {})}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
