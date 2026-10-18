import { useTranslation } from 'react-i18next';
import { ApiRequestError } from '../lib/api';

/** Shows a translated message for an API error code, or a generic one. */
export function ErrorText({ error }: { error: unknown }) {
  const { t, i18n } = useTranslation();
  if (!error) return null;
  const code = error instanceof ApiRequestError ? error.code : 'generic';
  const key = i18n.exists(`errors.${code}`) ? `errors.${code}` : 'errors.generic';
  return (
    <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-red-800">
      {t(key)}
    </p>
  );
}
