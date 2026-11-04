import { useTranslation } from 'react-i18next';
import { ButtonLink, EmptyState } from '../components/ui';
import { Compass } from 'lucide-react';
import { Icon } from '../components/Icon';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<Icon icon={Compass} className="h-6 w-6" />}
      title={t('notFound.title')}
      action={<ButtonLink to="/">{t('notFound.back')}</ButtonLink>}
    />
  );
}
