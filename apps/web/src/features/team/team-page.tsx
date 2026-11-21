'use client';

import { SYSTEM_ROLES } from '@erp/domain';
import type { MessageKey } from '@erp/i18n';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  Input,
  NativeSelect,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@erp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';
import { useConnection } from '@/providers/connection-provider';

export function TeamPage() {
  const { writable } = useConnection();
  const { t } = useI18n();
  const { org } = useServices();
  const { orgId, role: myRole } = useMembership();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('cashier');

  const members = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => org.listMembers(orgId),
    enabled: can('users.manage'),
  });
  const add = useMutation({
    mutationFn: () => org.addMemberByEmail(orgId, email.trim(), role),
    onSuccess: () => {
      setEmail('');
      void queryClient.invalidateQueries({ queryKey: ['members', orgId] });
    },
  });

  if (!can('users.manage')) {
    return (
      <>
        <PageHeader title={t('team.title')} />
        <Alert variant="warning">{t('team.no_permission')}</Alert>
      </>
    );
  }

  // Only owners may grant the owner role (enforced by the database as well).
  const assignable = SYSTEM_ROLES.filter((r) => r !== 'owner' || myRole === 'owner');

  return (
    <>
      <PageHeader title={t('team.title')} />
      <div className="flex flex-col gap-6">
        <Card>
          {members.error ? <div className="p-4"><ErrorAlert error={members.error} onRetry={() => void members.refetch()} /></div> : null}
          {members.isPending ? <div className="p-6"><Spinner label={t('common.loading')} /></div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('team.email')}</TableHead>
                  <TableHead>{t('auth.full_name')}</TableHead>
                  <TableHead>{t('team.role')}</TableHead>
                  <TableHead>{t('products.col_status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.data?.map((m) => (
                  <TableRow key={m.membershipId}>
                    <TableCell dir="ltr" className="text-start">{m.email}</TableCell>
                    <TableCell>{m.fullName ?? '—'}</TableCell>
                    <TableCell>
                      {t(`role.${m.role}` as MessageKey)}
                      <span className="block text-xs text-muted-foreground">
                        {m.allBranches ? t('team.all_branches') : t('team.selected_branches')}
                      </span>
                    </TableCell>
                    <TableCell>
                      {m.isActive ? <Badge variant="success">{t('common.active')}</Badge> : <Badge variant="outline">{t('common.inactive')}</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardContent className="pt-5">
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) add.mutate();
              }}
            >
              {add.error ? <div className="w-full"><ErrorAlert error={add.error} /></div> : null}
              <Field label={t('team.email')} required hint={t('team.add_hint')} className="min-w-64 flex-1">
                {(p) => <Input {...p} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />}
              </Field>
              <Field label={t('team.role')}>
                {(p) => (
                  <NativeSelect {...p} value={role} onChange={(e) => setRole(e.target.value)}>
                    {assignable.map((r) => <option key={r} value={r}>{t(`role.${r}` as MessageKey)}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <Button type="submit" disabled={add.isPending || !writable} className="mb-5">{t('team.add')}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
