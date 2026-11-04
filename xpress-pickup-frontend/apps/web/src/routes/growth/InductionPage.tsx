import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Camera, Check, KeyRound, PackageOpen, Package as Box } from 'lucide-react';
import { useMe } from '../../auth/useAuth';
import { Icon } from '../../components/Icon';
import { Button, ButtonLink, Card, cx } from '../../components/ui';
import { markInductionPassed } from '../../lib/induction';
import { checkPhoto, type PhotoIssue } from '../../lib/photoQuality';

/** The five lessons, in order. Each ends in one check: a question, or the photo practice. */
const LESSONS = ['role', 'consent', 'shop', 'photos', 'rules'] as const;
type Lesson = (typeof LESSONS)[number];

/** Answer options per question; the first listed id is not always right — see ANSWER. */
const OPTIONS: Record<Exclude<Lesson, 'photos'>, string[]> = {
  role: ['signup', 'live', 'sale'],
  consent: ['agentFills', 'ownerApproves', 'cash'],
  shop: ['anyLicence', 'validPin', 'later'],
  rules: ['promise', 'banned', 'neither'],
};
const ANSWER: Record<Exclude<Lesson, 'photos'>, string> = {
  role: 'live',
  consent: 'ownerApproves',
  shop: 'validPin',
  rules: 'banned',
};

function Quiz({ lesson, onPass }: { lesson: Exclude<Lesson, 'photos'>; onPass: () => void }) {
  const { t } = useTranslation();
  const [pick, setPick] = useState('');
  const [checked, setChecked] = useState(false);
  const right = pick === ANSWER[lesson];
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 font-bold">{t(`induction.${lesson}.q`)}</legend>
      {OPTIONS[lesson].map((o) => (
        <label
          key={o}
          className={cx(
            'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm',
            pick === o ? 'border-plum bg-brand-050' : 'border-line bg-white',
            checked &&
              pick === o &&
              (right ? 'border-emerald bg-emerald-soft' : 'border-danger bg-danger-soft'),
          )}
        >
          <input
            type="radio"
            name={lesson}
            value={o}
            checked={pick === o}
            onChange={() => {
              setPick(o);
              setChecked(false);
            }}
            className="h-5 w-5 accent-plum"
          />
          {t(`induction.${lesson}.a.${o}`)}
        </label>
      ))}
      {checked && (
        <p
          role="status"
          className={cx('text-sm font-semibold', right ? 'text-emerald' : 'text-danger')}
        >
          {right ? t('induction.correct') : t(`induction.${lesson}.why`)}
        </p>
      )}
      {checked && right ? (
        <Button size="lg" className="w-full" onClick={onPass}>
          {t('induction.next')}
        </Button>
      ) : (
        <Button size="lg" className="w-full" disabled={!pick} onClick={() => setChecked(true)}>
          {t('induction.check')}
        </Button>
      )}
    </fieldset>
  );
}

type Shot = { file: File; url: string; issue: PhotoIssue | null };

/** Practice: one photo with the box closed and one with it open; both must pass the photo check. */
function PhotoPractice({ onPass }: { onPass: () => void }) {
  const { t } = useTranslation();
  const [shots, setShots] = useState<Partial<Record<'closed' | 'open', Shot>>>({});
  const [busy, setBusy] = useState(false);
  const take = async (side: 'closed' | 'open', file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const issue = file.type.startsWith('image/')
      ? await checkPhoto(file).catch(() => null)
      : 'dark';
    setShots((s) => ({ ...s, [side]: { file, url: URL.createObjectURL(file), issue } }));
    setBusy(false);
  };
  const same =
    shots.closed &&
    shots.open &&
    shots.closed.file.name === shots.open.file.name &&
    shots.closed.file.size === shots.open.file.size;
  const ok = !!shots.closed && !!shots.open && !shots.closed.issue && !shots.open.issue && !same;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {(['closed', 'open'] as const).map((side) => {
          const s = shots[side];
          return (
            <label
              key={side}
              className={cx(
                'flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed text-center text-sm font-semibold',
                s && !s.issue
                  ? 'border-emerald'
                  : s?.issue
                    ? 'border-danger'
                    : 'border-line-strong',
              )}
            >
              {s ? (
                <img src={s.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <>
                  <Icon
                    icon={side === 'closed' ? Box : PackageOpen}
                    className="h-8 w-8 text-plum"
                  />
                  <span>{t(`induction.photos.${side}`)}</span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted">
                    <Icon icon={Camera} className="h-3.5 w-3.5" /> {t('induction.photos.tap')}
                  </span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                aria-label={t(`induction.photos.${side}`)}
                onChange={(e) => void take(side, e.target.files?.[0])}
              />
            </label>
          );
        })}
      </div>
      <ul className="space-y-1 text-sm" aria-live="polite">
        {(['closed', 'open'] as const).map((side) => {
          const s = shots[side];
          if (!s) return null;
          return (
            <li key={side} className={s.issue ? 'text-danger' : 'text-emerald'}>
              {t(`induction.photos.${side}`)}:{' '}
              {s.issue ? t(`induction.photos.issue.${s.issue}`) : t('induction.photos.good')}
            </li>
          );
        })}
        {same && <li className="text-danger">{t('induction.photos.same')}</li>}
      </ul>
      <Button size="lg" className="w-full" disabled={!ok || busy} onClick={onPass}>
        {ok ? t('induction.next') : t('induction.photos.needBoth')}
      </Button>
    </div>
  );
}

/**
 * /induction — five short lessons for a new agent (gig worker), about five minutes. Each one
 * must be passed to go on; finishing it unlocks registration, which gives the agent their
 * login: their phone number with an OTP, and their agent code.
 */
export function InductionPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [step, setStep] = useState(-1); // -1 = welcome, LESSONS.length = done
  const lesson = LESSONS[step];
  const next = () => {
    if (step + 1 === LESSONS.length) markInductionPassed();
    setStep(step + 1);
    window.scrollTo(0, 0);
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <div className="mb-1.5 flex justify-between text-sm font-semibold">
          <span>{t('induction.title')}</span>
          <span className="text-muted">
            {step < 0
              ? t('induction.minutes')
              : step < LESSONS.length
                ? t('induction.stepOf', { n: step + 1, total: LESSONS.length })
                : t('induction.doneShort')}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-sand" aria-hidden>
          <div
            className="h-full rounded-full bg-plum transition-[width]"
            style={{ width: `${(Math.max(0, step) / LESSONS.length) * 100}%` }}
          />
        </div>
      </div>

      {step < 0 && (
        <Card className="space-y-4 p-6">
          <h1 className="text-2xl font-extrabold">{t('induction.welcomeTitle')}</h1>
          <p className="text-muted">{t('induction.welcomeBody')}</p>
          <ol className="space-y-2">
            {LESSONS.map((l, i) => (
              <li key={l} className="flex items-center gap-3 text-sm font-semibold">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-050 text-plum">
                  {i + 1}
                </span>
                {t(`induction.${l}.title`)}
              </li>
            ))}
          </ol>
          <Button size="lg" className="w-full" onClick={() => setStep(0)}>
            {t('induction.start')}
          </Button>
        </Card>
      )}

      {lesson && (
        <Card key={lesson} className="space-y-5 p-6">
          <h2 className="text-2xl font-extrabold">{t(`induction.${lesson}.title`)}</h2>
          <ul className="space-y-3">
            {[1, 2, 3].map((n) => (
              <li key={n} className="flex gap-3">
                <Icon icon={Check} className="mt-0.5 h-5 w-5 shrink-0 text-emerald" />
                <span>{t(`induction.${lesson}.p${n}`)}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-line pt-5">
            {lesson === 'photos' ? (
              <PhotoPractice onPass={next} />
            ) : (
              <Quiz lesson={lesson} onPass={next} />
            )}
          </div>
        </Card>
      )}

      {step >= LESSONS.length && (
        <Card className="space-y-4 p-6 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald text-white">
            <Icon icon={BadgeCheck} className="h-7 w-7" />
          </span>
          <h2 className="text-2xl font-extrabold">{t('induction.doneTitle')}</h2>
          <p className="text-muted">{t('induction.doneBody')}</p>
          <div className="rounded-2xl bg-sand/60 p-4 text-left text-sm">
            <p className="flex items-center gap-2 font-bold">
              <Icon icon={KeyRound} className="h-4 w-4" /> {t('induction.loginTitle')}
            </p>
            <p className="mt-1">{t('induction.loginBody')}</p>
          </div>
          <ButtonLink
            size="lg"
            className="w-full"
            to={me ? '/agent' : `/login?next=${encodeURIComponent('/agent')}`}
          >
            {me ? t('induction.getLogin') : t('induction.signInForLogin')}
          </ButtonLink>
        </Card>
      )}

      {step >= 0 && step < LESSONS.length && (
        <p className="text-center text-xs text-muted">
          <Link to="/terms/agent" className="underline underline-offset-2">
            {t('agent.rules')}
          </Link>
        </p>
      )}
    </div>
  );
}
