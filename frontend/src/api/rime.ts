export type ArtistRef = {
  id: string;
  name: string;
  role?: string;
};

export type AlbumRef = {
  id: string;
  title: string;
};

export type Track = {
  id: string;
  title: string;
  album: AlbumRef;
  artists: ArtistRef[];
  durationMs: number;
  discNumber?: number;
  trackNumber?: number;
  artworkId?: string;
};

export type SearchPage = {
  items: Track[];
  nextCursor?: string;
};

export type PlaybackSession = {
  sessionId: string;
  track: Track;
  source: {
    kind: 'direct' | 'transcode';
    href: string;
    contentType: string;
    container: string;
    codec?: string;
    seekMethod: 'byteRange' | 'time';
  };
  expiresAt: string;
};

type Problem = {
  title?: string;
  detail?: string;
  code?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as Problem;
    throw new ApiError(problem.detail || problem.title || `请求失败 (${response.status})`, response.status, problem.code);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function searchTracks(query: string, signal?: AbortSignal): Promise<SearchPage> {
  const parameters = new URLSearchParams({ query, limit: '30' });
  return request<SearchPage>(`/api/v1/search?${parameters}`, { signal });
}

export function artworkUrl(artworkId: string | undefined, size: 128 | 256 | 512 | 1024): string | undefined {
  return artworkId ? `/api/v1/artworks/${encodeURIComponent(artworkId)}?size=${size}` : undefined;
}

export function createPlaybackSession(trackId: string, playerId: string): Promise<PlaybackSession> {
  return request<PlaybackSession>('/api/v1/playback/sessions', {
    method: 'POST',
    body: JSON.stringify({
      trackId,
      playerId,
      capabilities: {
        supportsByteRange: true,
        formats: [
          { container: 'mp3', codec: 'mp3' },
          { container: 'm4a', codec: 'aac' },
          { container: 'mp4', codec: 'aac' },
          { container: 'aac', codec: 'aac' },
          { container: 'flac', codec: 'flac' },
          { container: 'ogg', codec: 'vorbis' },
          { container: 'opus', codec: 'opus' },
          { container: 'wav', codec: 'pcm' },
          { container: 'wave', codec: 'pcm' },
        ],
      },
    }),
  });
}

export function recordPlaybackEvent(
  sessionId: string,
  type: 'started' | 'progress' | 'paused' | 'ended',
  positionMs: number,
): Promise<void> {
  return request<void>(`/api/v1/playback/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({
      eventId: crypto.randomUUID(),
      type,
      positionMs: Math.max(0, Math.round(positionMs)),
      occurredAt: new Date().toISOString(),
    }),
  });
}

export function deletePlaybackSession(sessionId: string): Promise<void> {
  return request<void>(`/api/v1/playback/sessions/${sessionId}`, { method: 'DELETE' });
}
