import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMe } from '../../auth/useAuth';
import { inductionPassed } from '../../lib/induction';
import {
  INDUCTION_VERSION,
  formatPaise,
  isValidGstin,
  type AgentMe,
  type MerchantDraft,
} from '@pataka/shared';
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
  useAgentPan,
  useAgentRegister,
  useAgentUpi,
  useMerchantAction,
  useNewMerchant,
  useNotifications,
} from '../../lib/growth';
import { openShopSetup } from '../../lib/queries';
import { TermsCheck } from './TermsCheck';
import { Circle, CircleCheck } from 'lucide-react';
import { dateTimeIST } from '../../lib/format';
import { Icon } from '../../components/Icon';

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

const INTRO_POINTS = ['what', 'paid', 'need', 'time'] as const;
const INTRO_STEPS = ['apply', 'induction', 'register', 'approval'] as const;

/**
 * First visit to the agent portal: what an agent is, how they are paid, and the steps. Apply
 * now opens the 5-minute induction; after it the visitor signs in (if needed) and registers.
 */
function AgentIntro({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  const next = inductionPassed()
    ? signedIn
      ? null
      : `/login?next=${encodeURIComponent('/agent')}`
    : '/induction';
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="night-sky relative px-6 py-8 text-white sm:px-10 sm:py-10">
          <img
            src="/bea.png"
            alt=""
            width={192}
            height={192}
            className="pointer-events-none absolute right-6 bottom-4 hidden h-28 w-28 drop-shadow-[0_14px_18px_rgb(3_25_41/0.55)] sm:block"
          />
          <p className="text-xs font-bold tracking-[0.14em] text-gold-light uppercase">
            {t('agent.intro.eyebrow')}
          </p>
          <h2 className="mt-2 max-w-xl text-3xl font-extrabold text-white sm:text-4xl">
            {t('agent.intro.title')}
          </h2>
          <p className="mt-3 max-w-xl text-white/85">{t('agent.intro.lead')}</p>
          {next && (
            <ButtonLink to={next} size="lg" variant="secondary" className="mt-6 border-white">
              {t('agent.intro.apply')}
            </ButtonLink>
          )}
        </div>
        <ul className="grid gap-3 p-6 sm:grid-cols-2 sm:p-8">
          {INTRO_POINTS.map((p) => (
            <li key={p} className="rounded-2xl bg-brand-050 p-4">
              <span className="block font-bold">{t(`agent.intro.points.${p}.title`)}</span>
              <span className="mt-0.5 block text-sm text-muted">
                {t(`agent.intro.points.${p}.body`)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-6 sm:p-8">
        <h2 className="text-2xl font-bold">{t('agent.intro.stepsTitle')}</h2>
        <ol className="mt-5 grid gap-3 md:grid-cols-4">
          {INTRO_STEPS.map((s, i) => (
            <li key={s} className="rounded-2xl bg-sand/60 p-4">
              <span className="font-display text-2xl font-extrabold text-gold-deep">0{i + 1}</span>
              <p className="mt-1 font-semibold">{t(`agent.intro.steps.${s}.title`)}</p>
              <p className="mt-1 text-sm text-muted">{t(`agent.intro.steps.${s}.body`)}</p>
            </li>
          ))}
        </ol>
        {next && (
          <ButtonLink to={next} size="lg" className="mt-6">
            {t('agent.intro.apply')}
          </ButtonLink>
        )}
      </Card>
    </div>
  );
}

function Register() {
  const { t } = useTranslation();
  const reg = useAgentRegister();
  const [f, setF] = useState({ name: '', upiId: '' });
  const [terms, setTerms] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    reg.mutate({
      name: f.name.trim(),
      upiId: f.upiId.trim(),
      acceptTerms: terms as true,
      inductionVersion: INDUCTION_VERSION,
    });
  };
  // Registering (and so getting a login) comes after the 5-minute induction.
  if (!inductionPassed()) return <AgentIntro signedIn />;
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
        <Field label={t('agent.payouts.upiId')} hint={t('agent.payouts.upiHint')}>
          <Input
            required
            value={f.upiId}
            onChange={(e) => setF({ ...f, upiId: e.target.value })}
            placeholder="name@bank" // i18n-ignore: format example
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
        ) : m.payout === 'sent' ? (
          <Badge tone="emerald">{t('agent.paid')}</Badge>
        ) : m.payout === 'pending' || m.payout === 'failed' ? (
          <Badge tone="gold">{t('agent.payoutPending')}</Badge>
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
                    <Icon icon={m.missing.includes(k) ? Circle : CircleCheck} />{' '}
                    {t(`agent.need.${k}`)}
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

/** Each ₹1,000 goes straight to the agent's UPI ID: where, how much so far, PAN when needed. */
function Payouts({ me }: { me: AgentMe }) {
  const { t } = useTranslation();
  const setPan = useAgentPan();
  const setUpi = useAgentUpi();
  const [pan, setPanText] = useState('');
  const [upi, setUpiText] = useState('');
  const [changing, setChanging] = useState(false);
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{t('agent.payouts.title')}</h2>
          <p className="text-sm text-muted">{t('agent.payouts.upiTo', { upi: me.upiHint })}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setChanging((v) => !v)}>
          {t('agent.payouts.changeUpi')}
        </Button>
      </div>
      {changing && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setUpi.mutate(upi.trim(), { onSuccess: () => setChanging(false) });
          }}
        >
          <Field label={t('agent.payouts.newUpi')} hint={t('agent.payouts.upiHint')}>
            <Input
              required
              value={upi}
              onChange={(e) => setUpiText(e.target.value)}
              placeholder="name@bank" // i18n-ignore: format example
            />
          </Field>
          <Button size="sm" disabled={setUpi.isPending}>
            {t('agent.payouts.saveUpi')}
          </Button>
          <ErrorText error={setUpi.error} />
        </form>
      )}
      <dl className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['earned', me.fyEarnedPaise],
            ['paid', me.paidPaise],
            ['pending', me.pendingPaise],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-xl bg-ivory p-3">
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t(`agent.payouts.${k}`, { fy: me.fy })}
            </dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{formatPaise(v)}</dd>
          </div>
        ))}
      </dl>
      {(me.panRequired || me.panPrompt) && !me.panOnFile && (
        <form
          className="space-y-2 rounded-xl border border-saffron/40 bg-saffron-bg p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setPan.mutate(pan.trim());
          }}
        >
          <p className="text-sm font-semibold">
            {me.panRequired ? t('agent.payouts.panRequired') : t('agent.payouts.panPrompt')}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('agent.payouts.pan')}>
              <Input
                required
                maxLength={10}
                value={pan}
                onChange={(e) => setPanText(e.target.value.toUpperCase())}
                placeholder="ABCDE1234F" // i18n-ignore: format example
              />
            </Field>
            <Button size="sm" disabled={pan.trim().length !== 10 || setPan.isPending}>
              {t('agent.payouts.savePan')}
            </Button>
          </div>
          <ErrorText error={setPan.error} />
        </form>
      )}
      {me.payouts.length === 0 ? (
        <p className="text-sm text-muted">{t('agent.payouts.none')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {me.payouts.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <p className="font-semibold">{p.shopName}</p>
                <p className="text-xs text-muted">
                  {dateTimeIST(p.earnedAt)}
                  {p.tdsPaise > 0 &&
                    ` · ${t('agent.payouts.tds', { amount: formatPaise(p.tdsPaise) })}`}
                  {p.utr && ` · UTR ${p.utr}`}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums">{formatPaise(p.netPaise)}</p>
                <Badge
                  tone={
                    p.status === 'sent'
                      ? 'emerald'
                      : p.status === 'failed' || p.status === 'reversed'
                        ? 'danger'
                        : p.blocked
                          ? 'saffron'
                          : 'gold'
                  }
                >
                  {p.blocked
                    ? t('agent.payouts.blockedPan')
                    : t(`agent.payouts.status.${p.status}`)}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Agent portal: code, merchants and each one's steps, and the payouts for the shops that went live. */
export function AgentPage() {
  const { t } = useTranslation();
  const { data: user, isPending: userPending } = useMe();
  const me = useAgentMe(!!user);
  const notes = useNotifications();
  const [links, setLinks] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  // A link is known only in the response that made it; keep it for this visit.
  const remember = (d: MerchantDraft) => {
    if (d.ownerLink) setLinks((l) => ({ ...l, [d.id]: d.ownerLink! }));
  };

  if (userPending) return <Spinner label={t('common.loading')} />;
  // Visitors read what the role is first; Apply now starts the induction, no sign-in needed.
  if (!user)
    return (
      <div className="space-y-6">
        <PageTitle eyebrow={t('agent.eyebrow')} title={t('agent.title')} />
        <AgentIntro signedIn={false} />
      </div>
    );
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
                <ButtonLink to="/terms/agent" variant="ghost" size="sm">
                  {t('agent.rules')}
                </ButtonLink>
              </div>
              {user && (
                <p className="rounded-xl bg-sand/60 px-3 py-2 text-sm font-semibold">
                  {t('agent.loginCard', { phone: user.phone, code: me.data!.code })}
                </p>
              )}
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

          <Payouts me={me.data!} />

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
