import { useTranslation } from 'react-i18next';
import type { Membership } from '@pataka/shared';

export function MembershipList({ memberships }: { memberships: Membership[] }) {
  const { t } = useTranslation();
  if (memberships.length === 0) return <span className="text-stone-500">—</span>;
  return (
    <ul>
      {memberships.map((m) => (
        <li key={`${m.kind}:${m.id}`}>
          {m.kind === 'shop'
            ? t('members.atShop', { name: m.name, code: m.code })
            : t('members.atCluster', { name: m.name })}
        </li>
      ))}
    </ul>
  );
}
