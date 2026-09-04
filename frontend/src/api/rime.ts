export type ArtistRef = {
  id: string;
  name: string;
  role?: string;
};

export type AlbumRef = {
  id: string;
  title: string;
};

export type ArtworkFocus = {
  x: number;
  y: number;
};

export type Album = {
  id: string;
  title: string;
  artists: ArtistRef[];
  artworkId?: string;
  addedAt: string;
};

export type AlbumPage = {
  items: Album[];
};

export type AlbumDetail = Album & {
  tracks: Track[];
  /**
   * 专辑详情接口可选返回的简介文本。
   *
   * 服务端尚未提供或返回空白文本时，客户端会保留简介区域的版式空间但不显示入口；
   * 这样后续补充资料不会改变顶部操作区的垂直位置。
   */
  description?: string;
};

export type ArtistDetail = ArtistRef & {
  albums: Album[];
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
  artworkFocus?: ArtworkFocus;
};

export type SearchPage = {
  items: Track[];
  nextCursor?: string;
};

export type LyricsLine = {
  startMs?: number;
  endMs?: number;
  text: string;
};

export type LyricsDocument = {
  trackId: string;
  source: 'manual' | 'sidecar' | 'embedded' | 'lrclib';
  synced: boolean;
  lines: LyricsLine[];
};

export type ScheduledTask = {
  id: string;
  name: string;
  status: 'idle' | 'running';
  lastRunAt?: string;
  lastDurationMs?: number;
  lastSucceeded?: boolean;
};

export type ScheduledTaskPage = {
  items: ScheduledTask[];
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
    bitrateKbps?: number;
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

/**
 * 获取按入库时间倒序排列的专辑。
 * @param limit 需要返回的专辑数量，后端当前允许的范围为 1 至 50。
 * @param signal 用于在离开页面时取消未完成请求的 AbortSignal（中止信号）。
 * @returns 包含最近入库专辑的 Promise（异步结果）。
 */
export function getRecentAlbums(limit = 12, signal?: AbortSignal): Promise<AlbumPage> {
  const parameters = new URLSearchParams({ limit: String(limit) });
  return request<AlbumPage>(`/api/v1/albums/recent?${parameters}`, { signal });
}

/**
 * 获取专辑详情及其可播放曲目。
 * @param albumId 专辑的唯一标识。
 * @param signal 用于在离开详情页时取消未完成请求的 AbortSignal（中止信号）。
 * @returns 包含专辑信息和曲目列表的 Promise（异步结果）。
 */
export function getAlbumDetail(albumId: string, signal?: AbortSignal): Promise<AlbumDetail> {
  return request<AlbumDetail>(`/api/v1/albums/${encodeURIComponent(albumId)}`, { signal });
}

/**
 * 获取歌手详情及其参与的可播放专辑。
 * @param artistId 歌手的唯一标识。
 * @param signal 用于在离开详情页时取消未完成请求的 AbortSignal（中止信号）。
 * @returns 包含歌手信息和专辑列表的 Promise（异步结果）。
 */
export function getArtistDetail(artistId: string, signal?: AbortSignal): Promise<ArtistDetail> {
  return request<ArtistDetail>(`/api/v1/artists/${encodeURIComponent(artistId)}`, { signal });
}

export function getTrackLyrics(trackId: string, signal?: AbortSignal): Promise<LyricsDocument> {
  return request<LyricsDocument>(`/api/v1/tracks/${encodeURIComponent(trackId)}/lyrics`, { signal });
}

export function getScheduledTasks(signal?: AbortSignal): Promise<ScheduledTaskPage> {
  return request<ScheduledTaskPage>('/api/v1/system/tasks', { signal });
}

export function runScheduledTask(taskId: string): Promise<ScheduledTask> {
  return request<ScheduledTask>(`/api/v1/system/tasks/${encodeURIComponent(taskId)}/runs`, { method: 'POST' });
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
