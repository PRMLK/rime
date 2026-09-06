import { ArrowRight, LoaderCircle, Server, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { RimeLogo } from '@/components/RimeLogo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import {
  getActiveServer,
  isTauriClient,
  leaveActiveServer,
  listSavedServers,
  probeServer,
  removeSavedServer,
  selectServer,
  type SavedServer,
} from '@/lib/mobile-server';

export type MobileServerConnection = {
  server: SavedServer;
  switchServer: () => void;
};

type MobileServerGateProps = {
  children: (connection?: MobileServerConnection) => ReactNode;
};

export function MobileServerGate({ children }: MobileServerGateProps) {
  const isMobileApp = isTauriClient();
  const [activeServer, setActiveServer] = useState(() => isMobileApp ? getActiveServer() : undefined);
  const [savedServers, setSavedServers] = useState(() => isMobileApp ? listSavedServers() : []);
  const [isReady, setIsReady] = useState(!isMobileApp);
  const [isConnecting, setIsConnecting] = useState(Boolean(activeServer));
  const [error, setError] = useState<string>();

  const refreshServers = useCallback(() => setSavedServers(listSavedServers()), []);

  const connect = useCallback(async (address: string) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    setIsConnecting(true);
    setError(undefined);
    try {
      const server = await probeServer(address, controller.signal);
      selectServer(server);
      refreshServers();
      setActiveServer(server);
      setIsReady(true);
    } catch (connectionError) {
      setError(connectionError instanceof DOMException && connectionError.name === 'AbortError'
        ? '连接超时，请检查服务器地址和网络'
        : connectionError instanceof Error ? connectionError.message : '无法连接到服务器');
      setIsReady(false);
    } finally {
      window.clearTimeout(timeout);
      setIsConnecting(false);
    }
  }, [refreshServers]);

  useEffect(() => {
    if (!isMobileApp || !activeServer) return;
    void connect(activeServer.url);
  }, []); // Existing selection is checked once when the native app starts.

  const switchServer = useCallback(() => {
    leaveActiveServer();
    setActiveServer(undefined);
    setError(undefined);
    setIsReady(false);
    refreshServers();
  }, [refreshServers]);

  if (!isMobileApp) return children();
  if (isReady && activeServer) return children({ server: activeServer, switchServer });

  return (
    <main className="flex min-h-[100dvh] items-center justify-center overflow-auto bg-muted/30 px-5 py-[max(env(safe-area-inset-top),2rem)]">
      <div className="flex w-full max-w-sm flex-col gap-7 py-6">
        <header className="flex items-end justify-between gap-4 px-1">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">连接到 Rime</h1>
            <p className="text-sm text-muted-foreground">选择你的音乐服务器</p>
          </div>
          <RimeLogo />
        </header>

        {savedServers.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="saved-servers-title">
            <h2 id="saved-servers-title" className="px-1 text-sm font-medium">已保存的服务器</h2>
            <ItemGroup className="gap-2">
              {savedServers.map((server) => (
                <Item key={server.id} variant="outline" className="flex-nowrap">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    disabled={isConnecting}
                    onClick={() => void connect(server.url)}
                  >
                    <ItemMedia variant="icon"><Server aria-hidden="true" /></ItemMedia>
                    <ItemContent>
                      <ItemTitle>{server.name}</ItemTitle>
                      <ItemDescription className="truncate">{server.url}</ItemDescription>
                    </ItemContent>
                    {server.url.startsWith('http://') && <Badge variant="outline">HTTP</Badge>}
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                  <ItemActions>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`移除服务器 ${server.name}`}
                      disabled={isConnecting}
                      onClick={() => {
                        removeSavedServer(server.id);
                        refreshServers();
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </section>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{savedServers.length > 0 ? '连接其他服务器' : '添加服务器'}</CardTitle>
            <CardDescription>输入 Rime 服务的根地址。</CardDescription>
          </CardHeader>
          <CardContent>
            <ServerAddressForm error={error} pending={isConnecting} onConnect={connect} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function ServerAddressForm({
  error,
  pending,
  onConnect,
}: {
  error?: string;
  pending: boolean;
  onConnect: (address: string) => Promise<void>;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onConnect(String(new FormData(event.currentTarget).get('serverUrl') ?? ''));
  };

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="mobile-server-url">服务器地址</FieldLabel>
          <Input
            id="mobile-server-url"
            name="serverUrl"
            type="text"
            inputMode="url"
            placeholder="https://music.example.com"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={Boolean(error)}
            disabled={pending}
            required
            autoFocus
          />
          <FieldDescription>HTTP 地址仅建议在可信局域网内使用。</FieldDescription>
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Server data-icon="inline-start" />}
          {pending ? '正在连接' : '连接服务器'}
        </Button>
      </FieldGroup>
    </form>
  );
}
