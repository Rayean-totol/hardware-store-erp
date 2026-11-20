'use client';

import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@erp/ui';
import { Boxes } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useSession } from '@/providers/session-provider';

export function LoginForm() {
  const { t } = useI18n();
  const { auth } = useServices();
  const session = useSession();
  const router = useRouter();
  const [mode, setMode] = React.useState<'sign_in' | 'sign_up'>('sign_in');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (session.status === 'signed_in') router.replace('/products/');
  }, [session.status, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'sign_in') {
        await auth.signIn(email.trim(), password);
      } else {
        const { needsConfirmation } = await auth.signUp(email.trim(), password, fullName.trim());
        if (needsConfirmation) {
          setNotice(t('auth.check_email'));
          setMode('sign_in');
        }
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-semibold">
          <Boxes className="size-5 text-primary" aria-hidden="true" />
          {t('app.name')}
        </span>
        <LanguageSwitcher />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{mode === 'sign_in' ? t('auth.sign_in_title') : t('auth.sign_up_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {notice ? <Alert variant="success">{notice}</Alert> : null}
            {error ? <ErrorAlert error={error} /> : null}
            {mode === 'sign_up' ? (
              <Field label={t('auth.full_name')} required>
                {(p) => <Input {...p} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />}
              </Field>
            ) : null}
            <Field label={t('auth.email')} required>
              {(p) => (
                <Input {...p} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              )}
            </Field>
            <Field label={t('auth.password')} required>
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  dir="ltr"
                  value={password}
                  minLength={8}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
                  required
                />
              )}
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.loading') : mode === 'sign_in' ? t('auth.sign_in') : t('auth.sign_up')}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {mode === 'sign_in' ? t('auth.no_account') : t('auth.have_account')}{' '}
              <Button variant="link" className="h-auto p-0" onClick={() => setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in')}>
                {mode === 'sign_in' ? t('auth.sign_up') : t('auth.sign_in')}
              </Button>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
