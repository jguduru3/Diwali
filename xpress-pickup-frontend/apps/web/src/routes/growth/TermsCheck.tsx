import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TermsParty } from '@pataka/shared';

/** "I accept the terms" with a link to the plain-language page for that party. */
export function TermsCheck({
  party,
  checked,
  onChange,
}: {
  party: TermsParty;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex items-start gap-3 rounded-xl border border-line bg-ivory p-3 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 accent-plum"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {t('terms.accept')}{' '}
        <Link to={`/terms/${party}`} target="_blank" className="font-semibold text-plum underline">
          {t(`terms.title.${party}`)}
        </Link>
      </span>
    </label>
  );
}
