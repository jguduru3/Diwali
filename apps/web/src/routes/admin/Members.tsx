import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  adminMembersResponseSchema,
  ROLES,
  VENDOR_ROLES,
  staffMemberSchema,
  type AssignRole,
  type Role,
} from '@pataka/shared';
import { ErrorText } from '../../components/ErrorText';
import { MembershipList } from '../../components/MembershipList';
import { Badge, Button, Card, Field, Input, Notice, Select, Spinner } from '../../components/ui';
import { api } from '../../lib/api';

const MEMBERS_KEY = ['admin', 'members'] as const;

/** Admin: give phone numbers a merchant (owner, staff, packer, cashier), marshal or admin role. */
export function Members() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: () => api('/console/members', { schema: adminMembersResponseSchema }),
  });

  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('shop_owner');
  const [shopShortCode, setShop] = useState('');
  const [clusterId, setCluster] = useState('');
  const [displayName, setName] = useState('');

  const assign = useMutation({
    mutationFn: (body: AssignRole) =>
      api('/console/members', { method: 'POST', body, schema: staffMemberSchema }),
    onSuccess: () => {
      setPhone('');
      setName('');
      void qc.invalidateQueries({ queryKey: MEMBERS_KEY });
    },
  });

  const needsShop = (VENDOR_ROLES as readonly Role[]).includes(role);
  const needsCluster = role === 'marshal';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    assign.mutate({
      phone,
      role,
      ...(needsShop ? { shopShortCode } : {}),
      ...(needsCluster ? { clusterId } : {}),
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
    });
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-xl font-semibold">{t('members.title')}</h2>
        <p className="mt-1 mb-5 text-sm text-muted">{t('members.intro')}</p>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <Field label={t('members.phone')}>
            <Input
              type="tel"
              inputMode="numeric"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label={t('members.name')}>
            <Input value={displayName} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('members.role')}>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          {needsShop && (
            <Field label={t('members.shop')}>
              <Select required value={shopShortCode} onChange={(e) => setShop(e.target.value)}>
                <option value="">{t('members.choose')}</option>
                {data?.shops.map((s) => (
                  <option key={s.id} value={s.shortCode}>
                    {s.name} ({s.shortCode})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {needsCluster && (
            <Field label={t('members.cluster')}>
              <Select required value={clusterId} onChange={(e) => setCluster(e.target.value)}>
                <option value="">{t('members.choose')}</option>
                {data?.clusters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="space-y-3 sm:col-span-2 lg:col-span-4">
            <ErrorText error={assign.error} />
            {assign.isSuccess && <Notice tone="emerald">{t('members.saved')}</Notice>}
            <Button disabled={assign.isPending}>{t('members.save')}</Button>
          </div>
        </form>
      </Card>

      {isPending && <Spinner label={t('common.loading')} />}
      <ErrorText error={error} />
      {data && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-sand/70 text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="px-4 py-3">{t('members.phone')}</th>
                <th className="px-4 py-3">{t('members.name')}</th>
                <th className="px-4 py-3">{t('members.role')}</th>
                <th className="px-4 py-3">{t('members.access')}</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.userId} className="border-t border-line/70">
                  <td className="px-4 py-3 font-mono whitespace-nowrap">{m.phone}</td>
                  <td className="px-4 py-3">{m.displayName ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge tone={m.role === 'admin' ? 'gold' : 'plum'}>
                      {t(`roles.${m.role}`)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <MembershipList memberships={m.memberships} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
