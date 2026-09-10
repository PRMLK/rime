import { useEffect, useMemo, useState } from 'react';
import { useClientCacheScope } from '@/mobile/lib/client-cache-context';
import { jsonFingerprint, readCachedJson, readCachedJsonSync, writeCachedJson } from '@/mobile/services/client-cache';

type ResourceState<T> = {
  resourceKey: string;
  data?: T;
  fingerprint?: string;
  isLoading: boolean;
  error?: string;
};

export function useCachedResource<T>({
  cacheKey,
  refreshKey,
  load,
  errorMessage = '内容加载失败',
}: {
  cacheKey: string;
  refreshKey?: string | number;
  load: (signal: AbortSignal) => Promise<T>;
  errorMessage?: string;
}) {
  const scope = useClientCacheScope();
  const resourceKey = useMemo(() => cacheKey, [cacheKey]);
  const [state, setState] = useState<ResourceState<T>>(() => {
    const cached = readCachedJsonSync<T>(scope, resourceKey);
    return {
      resourceKey,
      data: cached?.value,
      fingerprint: cached?.fingerprint,
      isLoading: !cached,
    };
  });
  const current = state.resourceKey === resourceKey
    ? state
    : { resourceKey, isLoading: true } satisfies ResourceState<T>;

  useEffect(() => {
    const controller = new AbortController();
    const synchronous = readCachedJsonSync<T>(scope, resourceKey);
    let displayedFingerprint = synchronous?.fingerprint;
    let hasData = Boolean(synchronous);
    let freshApplied = false;

    setState({
      resourceKey,
      data: synchronous?.value,
      fingerprint: synchronous?.fingerprint,
      isLoading: !synchronous,
    });

    const cachedRequest = readCachedJson<T>(scope, resourceKey).then((cached) => {
      if (!cached || controller.signal.aborted || freshApplied || displayedFingerprint === cached.fingerprint) return;
      displayedFingerprint = cached.fingerprint;
      hasData = true;
      setState({ resourceKey, data: cached.value, fingerprint: cached.fingerprint, isLoading: false });
    });

    void load(controller.signal)
      .then((fresh) => {
        if (controller.signal.aborted) return;
        freshApplied = true;
        const fingerprint = jsonFingerprint(fresh);
        hasData = true;
        if (displayedFingerprint !== fingerprint) {
          displayedFingerprint = fingerprint;
          setState({ resourceKey, data: fresh, fingerprint, isLoading: false });
        } else {
          setState((value) => value.resourceKey === resourceKey ? { ...value, isLoading: false, error: undefined } : value);
        }
        void writeCachedJson(scope, resourceKey, fresh);
      })
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) return;
        await cachedRequest;
        if (controller.signal.aborted || hasData) return;
        setState({
          resourceKey,
          isLoading: false,
          error: error instanceof Error ? error.message : errorMessage,
        });
      });

    return () => controller.abort();
  }, [errorMessage, load, refreshKey, resourceKey, scope]);

  return current;
}
