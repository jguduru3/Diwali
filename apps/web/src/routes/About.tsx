import { useTranslation } from 'react-i18next';
import { Card, PageTitle } from '../components/ui';

/** One-page explainer for police / fire officers (SPEC §15 runbook). */
export function About() {
  const { t } = useTranslation();
  const facts = ['noOnlineSale', 'noPayments', 'noStock', 'licensed', 'green', 'privacy'] as const;
  const flow = ['plan', 'slot', 'gate', 'counter'] as const;
  return (
    <div className="space-y-8">
      <PageTitle
        eyebrow={t('about.eyebrow')}
        title={t('about.title')}
        subtitle={t('about.subtitle')}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map((f) => (
          <Card key={f} className="p-6">
            <h2 className="text-lg font-semibold">{t(`about.facts.${f}.title`)}</h2>
            <p className="mt-2 text-sm text-muted">{t(`about.facts.${f}.body`)}</p>
          </Card>
        ))}
      </div>
      <Card className="p-6 sm:p-8">
        <h2 className="text-2xl font-semibold">{t('about.flowTitle')}</h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-4">
          {flow.map((f, i) => (
            <li key={f} className="rounded-2xl bg-sand/60 p-4">
              <span className="font-display text-2xl text-gold-deep">0{i + 1}</span>
              <p className="mt-1 font-semibold">{t(`about.flow.${f}.title`)}</p>
              <p className="mt-1 text-sm text-muted">{t(`about.flow.${f}.body`)}</p>
            </li>
          ))}
        </ol>
      </Card>
      <p className="text-sm text-muted">{t('about.legal')}</p>
    </div>
  );
}
