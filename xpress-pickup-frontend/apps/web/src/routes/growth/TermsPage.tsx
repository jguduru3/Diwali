import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TERMS_PARTIES, TERMS_VERSIONS, type TermsParty } from '@pataka/shared';
import { Card, PageTitle } from '../../components/ui';
import { NotFound } from '../NotFound';

/** Plain-language terms, one page per party: what you do, what you get, what you never do. */
export function TermsPage() {
  const { t } = useTranslation();
  const party = useParams().party as TermsParty;
  if (!(TERMS_PARTIES as readonly string[]).includes(party)) return <NotFound />;
  const points = t(`terms.points.${party}`, { returnObjects: true }) as string[];
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle
        eyebrow={t('terms.eyebrow', { version: TERMS_VERSIONS[party] })}
        title={t(`terms.title.${party}`)}
      />
      <Card className="p-6">
        <ol className="list-decimal space-y-3 pl-5">
          {(Array.isArray(points) ? points : []).map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
