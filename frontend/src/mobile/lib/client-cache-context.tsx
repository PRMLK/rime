import { createContext, useContext, type ReactNode } from 'react';

const ClientCacheScopeContext = createContext<string | undefined>(undefined);

export function ClientCacheProvider({ scope, children }: { scope: string; children: ReactNode }) {
  return <ClientCacheScopeContext.Provider value={scope}>{children}</ClientCacheScopeContext.Provider>;
}

export function useClientCacheScope(): string {
  const scope = useContext(ClientCacheScopeContext);
  if (!scope) throw new Error('ClientCacheProvider is required');
  return scope;
}
