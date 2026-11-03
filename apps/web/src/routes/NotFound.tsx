import { useTranslation } from 'react-i18next';
import { ButtonLink, EmptyState } from '../components/ui';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon="✦"
      title={t('notFound.title')}
      action={<ButtonLink to="/">{t('notFound.back')}</ButtonLink>}
    />
  );
}
