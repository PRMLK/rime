import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { PlaybackSession } from '@/api/rime';

export type MediaCacheStatus = {
  usedBytes: number;
  itemCount: number;
};

const emptyStatus: MediaCacheStatus = { usedBytes: 0, itemCount: 0 };

export function hasNativeMediaCache(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function resolveCachedMedia(scope: string, source: PlaybackSession['source']): Promise<string | undefined> {
  if (!hasNativeMediaCache() || !source.cacheable) return undefined;
  const path = await invoke<string | null>('resolve_cached_media', {
    request: { scope, contentKey: source.contentKey, container: source.container, expectedLength: source.contentLength },
  });
  return path ? convertFileSrc(path) : undefined;
}

export async function releaseCachedMedia(scope: string, source: PlaybackSession['source']): Promise<void> {
  if (!hasNativeMediaCache()) return;
  await invoke('release_cached_media', {
    request: { scope, contentKey: source.contentKey, container: source.container },
  });
}

export async function cacheMedia(scope: string, source: PlaybackSession['source'], maxBytes: number): Promise<MediaCacheStatus> {
  if (!hasNativeMediaCache() || !source.cacheable || maxBytes <= 0 || source.contentLength > maxBytes) return getMediaCacheStatus(scope);
  return invoke<MediaCacheStatus>('cache_media', {
    request: {
      scope,
      contentKey: source.contentKey,
      container: source.container,
      sourceUrl: source.href,
      expectedLength: source.contentLength,
      etag: source.etag,
      maxBytes,
    },
  });
}

export async function getMediaCacheStatus(scope: string): Promise<MediaCacheStatus> {
  if (!hasNativeMediaCache()) return emptyStatus;
  return invoke<MediaCacheStatus>('media_cache_status', { scope });
}

export async function pruneMediaCache(scope: string, maxBytes: number): Promise<MediaCacheStatus> {
  if (!hasNativeMediaCache()) return emptyStatus;
  return invoke<MediaCacheStatus>('prune_media_cache', { scope, maxBytes });
}

export async function clearMediaCache(scope: string): Promise<MediaCacheStatus> {
  if (!hasNativeMediaCache()) return emptyStatus;
  return invoke<MediaCacheStatus>('clear_media_cache', { scope });
}
