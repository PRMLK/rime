import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { PlaybackSession } from '@/mobile/api/rime';

export type MediaCacheStatus = {
  usedBytes: number;
  itemCount: number;
};

const emptyStatus: MediaCacheStatus = { usedBytes: 0, itemCount: 0 };

export function hasNativeMediaCache(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 判断当前是否是 Android Tauri WebView（网页视图）运行时。
 *
 * Android 的原生播放器不可用时，HTMLAudioElement（网页音频元素）会回退到网页内核。
 * 该内核读取 `asset` 协议的本地缓存文件时，部分系统 WebView 会在后续 Range（字节范围）
 * 请求中断流并报告 MediaError 2（网络错误）。这不是缓存文件完整性问题，因此回退路径
 * 必须直接使用服务端的 HTTP 范围串流；缓存仍可保留给原生播放器及其他平台使用。
 *
 * @returns 运行在 Android Tauri 容器时为 true；浏览器、iOS 和桌面端为 false。
 */
export function isAndroidTauriRuntime(): boolean {
  return typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && '__TAURI_INTERNALS__' in window
    && /\bAndroid\b/i.test(navigator.userAgent);
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
