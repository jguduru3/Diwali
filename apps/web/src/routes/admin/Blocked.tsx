import { useTranslation } from 'react-i18next';
import { ErrorText } from '../../components/ErrorText';
import { Button, Card, EmptyState, Spinner } from '../../components/ui';
import { dayIST } from '../../lib/format';
import { useBlocked, useUnblock } from '../../lib/queries';

/** Numbers blocked for misuse cannot place orders; admins can lift the block. */
export function Blocked() {
  const { t } = useTranslation();
  const list = useBlocked();
  const unblock = useUnblock();
  if (list.isPending) return <Spinner label={t('common.loading')} />;
  if (list.error) return <ErrorText error={list.error} />;
  if (!list.data.length)
    return <EmptyState icon="✓" title={t('admin.noneBlocked')} body={t('admin.blockedHelp')} />;
  return (
    <ul className="grid gap-3">
      {list.data.map((u) => (
        <Card as="li" key={u.userId} className="flex flex-wrap items-center gap-4 p-5">
          <div className="flex-1">
            <p className="font-mono font-semibold">{u.phone}</p>
            <p className="text-sm text-muted">
              {u.blockedUntil && t('admin.until', { date: dayIST(u.blockedUntil) })}
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={unblock.isPending}
            onClick={() => unblock.mutate(u.userId)}
          >
            {t('admin.unblock')}
          </Button>
        </Card>
      ))}
    </ul>
  );
}
