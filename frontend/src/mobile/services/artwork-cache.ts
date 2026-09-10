import { apiFetch, isTauriClient, resolveServerPath } from '@/mobile/lib/mobile-server';
import {
  readCachedArtwork,
  readCachedArtworkSync,
  writeCachedArtwork,
  type CachedArtwork,
} from '@/mobile/services/client-cache';

type ArtworkSize = 128 | 256 | 512 | 1024;
type ArtworkListener = {
  onSource: (source: string) => void;
  onError?: () => void;
};

type ArtworkRuntimeEntry = {
  source?: string;
  objectUrl?: string;
  fingerprint?: string;
  etag?: string;
  listeners: Set<ArtworkListener>;
  inflight?: Promise<void>;
  releaseTimer?: number;
  validated: boolean;
};

const runtimeEntries = new Map<string, ArtworkRuntimeEntry>();

export function artworkImmediateSource(artworkId: string | undefined, size: ArtworkSize): string | undefined {
  return artworkId && !isTauriClient() ? artworkPath(artworkId, size) : undefined;
}

export function subscribeArtworkSource(
  scope: string,
  artworkId: string,
  size: ArtworkSize,
  listener: ArtworkListener,
): () => void {
  const resourceKey = artworkResourceKey(artworkId, size);
  const runtimeKey = scopedRuntimeKey(scope, resourceKey);
  let entry = runtimeEntries.get(runtimeKey);
  if (!entry) {
    entry = {
      source: artworkImmediateSource(artworkId, size),
      listeners: new Set(),
      validated: false,
    };
    const cached = readCachedArtworkSync(scope, resourceKey);
    if (cached) applyCachedArtwork(entry, cached);
    runtimeEntries.set(runtimeKey, entry);
  }

  if (entry.releaseTimer !== undefined) {
    window.clearTimeout(entry.releaseTimer);
    entry.releaseTimer = undefined;
  }
  entry.listeners.add(listener);
  if (entry.source) listener.onSource(entry.source);
  if (!entry.validated && !entry.inflight) {
    entry.inflight = refreshArtwork(scope, resourceKey, artworkId, size, entry)
      .finally(() => { entry!.inflight = undefined; });
  }

  return () => {
    if (!entry) return;
    entry.listeners.delete(listener);
    if (entry.listeners.size > 0 || entry.releaseTimer !== undefined) return;
    entry.releaseTimer = window.setTimeout(() => {
      if (!entry || entry.listeners.size > 0) return;
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
      runtimeEntries.delete(runtimeKey);
    }, 30_000);
  };
}

export function clearArtworkRuntimeCache(scope: string): void {
  const prefix = `${scope}\u0000`;
  for (const [key, entry] of runtimeEntries) {
    if (!key.startsWith(prefix)) continue;
    if (entry.releaseTimer !== undefined) window.clearTimeout(entry.releaseTimer);
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    runtimeEntries.delete(key);
  }
}

async function refreshArtwork(
  scope: string,
  resourceKey: string,
  artworkId: string,
  size: ArtworkSize,
  entry: ArtworkRuntimeEntry,
): Promise<void> {
  let networkSucceeded = false;
  const cachedRequest = readCachedArtwork(scope, resourceKey).then((cached) => {
    if (!cached || networkSucceeded || entry.objectUrl) return;
    applyCachedArtwork(entry, cached);
    notifySource(entry);
  });

  try {
    const headers = new Headers();
    if (entry.etag) headers.set('If-None-Match', entry.etag);
    const response = await apiFetch(artworkPath(artworkId, size), { headers });
    if (response.status === 304) {
      networkSucceeded = true;
      entry.validated = true;
      return;
    }
    if (!response.ok) throw new Error(`封面加载失败 (${response.status})`);

    const blob = await response.blob();
    const etag = response.headers.get('ETag') ?? undefined;
    const fingerprint = etag ?? `${blob.type}:${blob.size}:${response.headers.get('Last-Modified') ?? ''}`;
    networkSucceeded = true;
    entry.validated = true;

    if (entry.fingerprint !== fingerprint || !entry.objectUrl) {
      applyCachedArtwork(entry, { blob, fingerprint, etag });
      notifySource(entry);
    } else {
      entry.fingerprint = fingerprint;
      entry.etag = etag;
    }
    void writeCachedArtwork(scope, resourceKey, { blob, fingerprint, etag });
  } catch {
    await cachedRequest;
    if (!entry.source) notifyError(entry);
  } finally {
    await cachedRequest;
  }
}

function applyCachedArtwork(entry: ArtworkRuntimeEntry, cached: CachedArtwork): void {
  const previousObjectUrl = entry.objectUrl;
  const objectUrl = URL.createObjectURL(cached.blob);
  entry.source = objectUrl;
  entry.objectUrl = objectUrl;
  entry.fingerprint = cached.fingerprint;
  entry.etag = cached.etag;
  if (previousObjectUrl) window.setTimeout(() => URL.revokeObjectURL(previousObjectUrl), 0);
}

function notifySource(entry: ArtworkRuntimeEntry): void {
  if (!entry.source) return;
  entry.listeners.forEach((listener) => listener.onSource(entry.source!));
}

function notifyError(entry: ArtworkRuntimeEntry): void {
  entry.listeners.forEach((listener) => listener.onError?.());
}

function artworkPath(artworkId: string, size: ArtworkSize): string {
  return `/api/v1/artworks/${encodeURIComponent(artworkId)}?size=${size}`;
}

function artworkResourceKey(artworkId: string, size: ArtworkSize): string {
  return resolveServerPath(artworkPath(artworkId, size));
}

function scopedRuntimeKey(scope: string, resourceKey: string): string {
  return `${scope}\u0000${resourceKey}`;
}
