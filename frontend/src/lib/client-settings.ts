export type PlaybackQuality = 'auto' | 'original' | 320 | 256 | 192 | 128 | 96;

export type ClientSettings = {
  maxCacheBytes: number;
  playbackQuality: PlaybackQuality;
};

const storagePrefix = 'rime.client-settings.v1';
const gibibyte = 1024 * 1024 * 1024;

export const defaultClientSettings: ClientSettings = {
  maxCacheBytes: 5 * gibibyte,
  playbackQuality: 'auto',
};

export function clientSettingsScope(serverId: string | undefined, userId: string): string {
  const origin = typeof window === 'undefined' ? 'local' : window.location.origin;
  return `${serverId ?? origin}\u001f${userId}`;
}

export function readClientSettings(scope: string): ClientSettings {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(scope)) ?? '') as Partial<ClientSettings>;
    return {
      maxCacheBytes: validCacheBytes(value.maxCacheBytes) ? value.maxCacheBytes : defaultClientSettings.maxCacheBytes,
      playbackQuality: validPlaybackQuality(value.playbackQuality) ? value.playbackQuality : defaultClientSettings.playbackQuality,
    };
  } catch {
    return defaultClientSettings;
  }
}

export function writeClientSettings(scope: string, settings: ClientSettings): void {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(settings));
  } catch {
    // Settings remain active in the current component when storage is unavailable.
  }
}

export function playbackQualityRequest(quality: PlaybackQuality): { quality: 'auto' | 'original' | 'limited'; maxBitrateKbps?: number } {
  if (quality === 'original') return { quality: 'original' };
  if (typeof quality === 'number') return { quality: 'limited', maxBitrateKbps: quality };

  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (connection?.saveData || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') {
    return { quality: 'auto', maxBitrateKbps: 128 };
  }
  if (connection?.effectiveType === '3g') {
    return { quality: 'auto', maxBitrateKbps: 192 };
  }
  return { quality: 'auto', maxBitrateKbps: 256 };
}

export function bytesToGibibytes(bytes: number): number {
  return Math.round(bytes / gibibyte);
}

export function gibibytesToBytes(gibibytes: number): number {
  return Math.max(0, Math.round(gibibytes)) * gibibyte;
}

function storageKey(scope: string): string {
  return `${storagePrefix}.${encodeURIComponent(scope)}`;
}

function validCacheBytes(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 50 * gibibyte;
}

function validPlaybackQuality(value: unknown): value is PlaybackQuality {
  return value === 'auto' || value === 'original' || value === 320 || value === 256 || value === 192 || value === 128 || value === 96;
}
