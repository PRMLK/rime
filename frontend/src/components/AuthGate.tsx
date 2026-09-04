import { LoaderCircle, LogIn, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  authChangedEvent,
  changePassword,
  getAuthStatus,
  login,
  setupAdmin,
  type AuthStatus,
  type User,
} from '@/api/rime';
import { RimeLogo } from '@/components/RimeLogo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function AuthGate({ children }: { children: (user: User, refreshAuth: () => void) => ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>();
  const [loadError, setLoadError] = useState<string>();

  const refreshAuth = useCallback(() => {
    const controller = new AbortController();
    setLoadError(undefined);
    getAuthStatus(controller.signal)
      .then(setStatus)
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : '身份状态加载失败'));
    return () => controller.abort();
  }, []);

  useEffect(() => refreshAuth(), [refreshAuth]);
  useEffect(() => {
    const refresh = () => refreshAuth();
    window.addEventListener(authChangedEvent, refresh);
    return () => window.removeEventListener(authChangedEvent, refresh);
  }, [refreshAuth]);

  if (!status) {
    return <AuthFrame>{loadError ? <AuthError message={loadError} onRetry={refreshAuth} /> : <LoaderCircle className="size-6 animate-spin text-muted-foreground" aria-label="正在加载" />}</AuthFrame>;
  }
  if (status.setupRequired) {
    return <SetupForm onComplete={(user) => setStatus({ setupRequired: false, authenticated: true, user })} />;
  }
  if (!status.authenticated || !status.user) {
    return <LoginForm onComplete={(user) => setStatus({ setupRequired: false, authenticated: true, user })} />;
  }
  if (status.user.mustChangePassword) {
    return <PasswordChangeForm user={status.user} onComplete={() => setStatus({ setupRequired: false, authenticated: false })} />;
  }
  return children(status.user, () => {
    setStatus(undefined);
    refreshAuth();
  });
}

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex h-[100dvh] items-center justify-center overflow-auto bg-muted/30 px-5 py-8">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Rime</h1>
            <p className="mt-1 text-sm text-muted-foreground">私人音乐空间</p>
          </div>
          <RimeLogo />
        </div>
        {children}
      </div>
    </main>
  );
}

function SetupForm({ onComplete }: { onComplete: (user: User) => void }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirmPassword') ?? '')) {
      setError('两次输入的密码不一致');
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      onComplete(await setupAdmin({
        username: String(form.get('username') ?? ''),
        displayName: String(form.get('displayName') ?? ''),
        password,
      }));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '管理员创建失败');
    } finally {
      setPending(false);
    }
  };
  return (
    <AuthFrame>
      <Card>
        <CardHeader>
          <CardTitle>注册首位管理员</CardTitle>
          <CardDescription>这是首次注册账号，将自动成为系统管理员。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <AuthInput name="username" label="用户名" autoComplete="username" minLength={3} maxLength={32} required />
              <AuthInput name="displayName" label="显示名称" autoComplete="name" maxLength={40} />
              <AuthInput name="password" label="密码" type="password" autoComplete="new-password" minLength={8} required />
              <AuthInput name="confirmPassword" label="确认密码" type="password" autoComplete="new-password" minLength={8} required />
              {error && <FieldError>{error}</FieldError>}
              <Button type="submit" size="lg" disabled={pending}>
                {pending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <ShieldCheck data-icon="inline-start" />}
                注册并进入
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </AuthFrame>
  );
}

function LoginForm({ onComplete }: { onComplete: (user: User) => void }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    try {
      onComplete(await login(String(form.get('username') ?? ''), String(form.get('password') ?? '')));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '登录失败');
    } finally {
      setPending(false);
    }
  };
  return (
    <AuthFrame>
      <Card>
        <CardHeader><CardTitle>登录</CardTitle><CardDescription>继续进入你的音乐库。</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <AuthInput name="username" label="用户名" autoComplete="username" required autoFocus />
              <AuthInput name="password" label="密码" type="password" autoComplete="current-password" required />
              {error && <FieldError>{error}</FieldError>}
              <Button type="submit" size="lg" disabled={pending}>
                {pending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <LogIn data-icon="inline-start" />}
                登录
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </AuthFrame>
  );
}

function PasswordChangeForm({ user, onComplete }: { user: User; onComplete: () => void }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = String(form.get('newPassword') ?? '');
    if (next !== String(form.get('confirmPassword') ?? '')) {
      setError('两次输入的密码不一致');
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      await changePassword(String(form.get('currentPassword') ?? ''), next);
      onComplete();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '密码修改失败');
    } finally {
      setPending(false);
    }
  };
  return (
    <AuthFrame>
      <Card>
        <CardHeader><CardTitle>设置新密码</CardTitle><CardDescription>{user.displayName}，首次登录需要更换临时密码。</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <AuthInput name="currentPassword" label="临时密码" type="password" autoComplete="current-password" required />
              <AuthInput name="newPassword" label="新密码" type="password" autoComplete="new-password" minLength={8} required />
              <AuthInput name="confirmPassword" label="确认新密码" type="password" autoComplete="new-password" minLength={8} required />
              {error && <FieldError>{error}</FieldError>}
              <Button type="submit" size="lg" disabled={pending}>{pending && <LoaderCircle data-icon="inline-start" className="animate-spin" />}保存新密码</Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </AuthFrame>
  );
}

function AuthInput({ label, description, ...props }: { label: string; description?: string } & React.ComponentProps<typeof Input>) {
  const id = `auth-${props.name}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} {...props} />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

function AuthError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <Card><CardHeader><CardTitle>无法连接</CardTitle><CardDescription>{message}</CardDescription></CardHeader><CardContent><Button onClick={onRetry}>重试</Button></CardContent></Card>;
}
