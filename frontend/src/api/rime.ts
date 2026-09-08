import {
  apiFetch,
  clearMobileSession,
  isTauriClient,
  resolveServerPath,
  saveMobileSession,
} from '@/lib/mobile-server';

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
  nextCursor?: string;
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
  nextCursor?: string;
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
  available: boolean;
};

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt?: string;
};

export type AuthStatus = {
  setupRequired: boolean;
  authenticated: boolean;
  user?: User;
};

export type Playlist = {
  id: string;
  name: string;
  kind: 'favorites' | 'custom';
  trackCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PlaylistDetail = Playlist & {
  tracks: Track[];
};

export type PlaylistPage = {
  items: Playlist[];
  nextCursor?: string;
};

export type SearchPage = {
  items: Track[];
  nextCursor?: string;
};

/** 当前用户的继续聆听歌曲，不包含播放进度。 */
export type PlaybackHistoryPage = {
  items: Track[];
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
    contentKey: string;
    contentLength: number;
    etag: string;
    profileId?: string;
    cacheable: boolean;
  };
  expiresAt: string;
};

/** 客户端可直接解码的一种媒体容器和编解码器组合。 */
export type PlaybackFormat = {
  container: string;
  codec: string;
};

/** 创建播放会话时声明的音质偏好与可选码率上限。 */
export type PlaybackQualityRequest = {
  quality: 'auto' | 'original' | 'limited';
  maxBitrateKbps?: number;
};

type Problem = {
  title?: string;
  detail?: string;
  code?: string;
};

type TokenSession = {
  accessToken: string;
  expiresAt: string;
  user: User;
};

const artworkObjectUrls = new Map<string, string>();

export const authChangedEvent = 'rime:auth-changed';
export const playlistsChangedEvent = 'rime:playlists-changed';
/** 专辑喜欢状态变更后触发，用于刷新首页的“我的喜欢”。 */
export const favoriteAlbumsChangedEvent = 'rime:favorite-albums-changed';
/** 播放器成功记录歌曲开始播放后触发，用于刷新首页继续聆听。 */
export const playbackHistoryChangedEvent = 'rime:playback-history-changed';

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
  const response = await apiFetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as Problem;
    if (response.status === 401) {
      if (isTauriClient()) clearMobileSession();
      window.dispatchEvent(new Event(authChangedEvent));
    }
    throw new ApiError(problem.detail || problem.title || `请求失败 (${response.status})`, response.status, problem.code);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function getAuthStatus(signal?: AbortSignal): Promise<AuthStatus> {
  return request<AuthStatus>('/api/v1/auth/status', { signal });
}

export async function setupAdmin(input: { username: string; displayName: string; password: string }): Promise<User> {
  if (!isTauriClient()) {
    return request<User>('/api/v1/auth/setup', { method: 'POST', body: JSON.stringify(input) });
  }
  const session = await request<TokenSession>('/api/v1/auth/token/setup', { method: 'POST', body: JSON.stringify(input) });
  saveMobileSession(session.accessToken, session.expiresAt);
  return session.user;
}

export async function login(username: string, password: string): Promise<User> {
  const body = JSON.stringify({ username, password });
  if (!isTauriClient()) {
    return request<User>('/api/v1/auth/login', { method: 'POST', body });
  }
  const session = await request<TokenSession>('/api/v1/auth/token', { method: 'POST', body });
  saveMobileSession(session.accessToken, session.expiresAt);
  return session.user;
}

export async function logout(): Promise<void> {
  try {
    await request<void>('/api/v1/auth/session', { method: 'DELETE' });
  } finally {
    if (isTauriClient()) clearMobileSession();
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request<void>('/api/v1/me/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) });
  if (isTauriClient()) clearMobileSession();
}

/**
 * 按游标取得当前用户的一批歌单。
 * @param limit 单批歌单数量，后端允许范围为 1 至 50。
 * @param cursor 服务端返回的下一批游标；未提供时请求第一批。
 * @param signal 页面切换或菜单关闭时用于取消请求的中止信号。
 * @returns 包含歌单和后续加载游标的异步结果。
 */
export function getPlaylists(limit = 10, cursor?: string, signal?: AbortSignal): Promise<PlaylistPage> {
  const parameters = new URLSearchParams({ limit: String(limit) });
  if (cursor) parameters.set('cursor', cursor);
  return request<PlaylistPage>(`/api/v1/me/playlists?${parameters}`, { signal });
}

/**
 * 读取当前用户全部歌单，供“添加到歌单”菜单建立完整可选集合。
 *
 * 菜单不是长列表页面，不能因主列表采用 10 条续页而遗漏较后的歌单；因此内部以最大
 * 批次连续请求并合并结果。调用方仍可通过 signal 在菜单关闭时中止整个读取过程。
 *
 * @param signal 用于取消连续请求的中止信号。
 * @returns 所有当前用户歌单的异步数组。
 */
export async function getAllPlaylists(signal?: AbortSignal): Promise<Playlist[]> {
  const items: Playlist[] = [];
  let cursor: string | undefined;
  do {
    const page = await getPlaylists(50, cursor, signal);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && !signal?.aborted);
  return items;
}

export function getPlaylist(playlistId: string, signal?: AbortSignal): Promise<PlaylistDetail> {
  return request<PlaylistDetail>(`/api/v1/me/playlists/${encodeURIComponent(playlistId)}`, { signal });
}

export async function createPlaylist(name: string): Promise<Playlist> {
  const playlist = await request<Playlist>('/api/v1/me/playlists', { method: 'POST', body: JSON.stringify({ name }) });
  window.dispatchEvent(new Event(playlistsChangedEvent));
  return playlist;
}

export async function renamePlaylist(playlistId: string, name: string): Promise<Playlist> {
  const playlist = await request<Playlist>(`/api/v1/me/playlists/${encodeURIComponent(playlistId)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  window.dispatchEvent(new Event(playlistsChangedEvent));
  return playlist;
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  await request<void>(`/api/v1/me/playlists/${encodeURIComponent(playlistId)}`, { method: 'DELETE' });
  window.dispatchEvent(new Event(playlistsChangedEvent));
}

export async function addTrackToPlaylist(playlistId: string, trackId: string): Promise<void> {
  await request<void>(`/api/v1/me/playlists/${encodeURIComponent(playlistId)}/tracks`, { method: 'POST', body: JSON.stringify({ trackId }) });
  window.dispatchEvent(new Event(playlistsChangedEvent));
}

export async function removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
  await request<void>(`/api/v1/me/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`, { method: 'DELETE' });
  window.dispatchEvent(new Event(playlistsChangedEvent));
}

export function getFavoriteStatus(trackId: string, signal?: AbortSignal): Promise<{ favorite: boolean }> {
  return request<{ favorite: boolean }>(`/api/v1/me/favorites/tracks/${encodeURIComponent(trackId)}`, { signal });
}

export async function setFavorite(trackId: string, favorite: boolean): Promise<void> {
  await request<void>(`/api/v1/me/favorites/tracks/${encodeURIComponent(trackId)}`, { method: favorite ? 'PUT' : 'DELETE' });
  window.dispatchEvent(new Event(playlistsChangedEvent));
}

/**
 * 获取当前用户直接喜欢的专辑。
 *
 * 歌曲喜欢所关联的专辑不在此接口返回，首页会将它们与本结果合并后去重。
 *
 * @param limit 需要返回的专辑数量，后端允许范围为 1 至 50。
 * @param signal 用于取消请求的 AbortSignal（中止信号）。
 * @returns 可直接展示为专辑卡片的异步专辑页。
 */
export function getFavoriteAlbums(limit = 12, signal?: AbortSignal): Promise<AlbumPage> {
  const parameters = new URLSearchParams({ limit: String(limit) });
  return request<AlbumPage>(`/api/v1/me/favorites/albums?${parameters}`, { signal });
}

/**
 * 查询当前用户是否直接喜欢目标专辑。
 *
 * @param albumId 专辑的唯一标识。
 * @param signal 用于在离开专辑详情时取消请求的 AbortSignal（中止信号）。
 * @returns 包含专辑喜欢状态的 Promise（异步结果）。
 */
export function getFavoriteAlbumStatus(albumId: string, signal?: AbortSignal): Promise<{ favorite: boolean }> {
  return request<{ favorite: boolean }>(`/api/v1/me/favorites/albums/${encodeURIComponent(albumId)}`, { signal });
}

/**
 * 设置当前用户对目标专辑的直接喜欢状态。
 *
 * @param albumId 专辑的唯一标识。
 * @param favorite true 表示喜欢，false 表示取消喜欢。
 * @returns 服务端完成写入后的 Promise（异步结果）。
 */
export async function setFavoriteAlbum(albumId: string, favorite: boolean): Promise<void> {
  await request<void>(`/api/v1/me/favorites/albums/${encodeURIComponent(albumId)}`, { method: favorite ? 'PUT' : 'DELETE' });
  window.dispatchEvent(new Event(favoriteAlbumsChangedEvent));
}

export function getUsers(signal?: AbortSignal): Promise<{ items: User[] }> {
  return request<{ items: User[] }>('/api/v1/admin/users', { signal });
}

export function createUser(input: { username: string; displayName: string; password: string; role: User['role'] }): Promise<User> {
  return request<User>('/api/v1/admin/users', { method: 'POST', body: JSON.stringify(input) });
}

export function updateUser(userId: string, input: { displayName?: string; role?: User['role']; disabled?: boolean }): Promise<User> {
  return request<User>(`/api/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function resetUserPassword(userId: string, password: string): Promise<void> {
  return request<void>(`/api/v1/admin/users/${encodeURIComponent(userId)}/password-reset`, { method: 'POST', body: JSON.stringify({ password }) });
}

/**
 * 搜索曲目，并按服务端游标取得指定结果页。
 *
 * @param query 搜索关键字；为空时返回曲库排序后的第一页。
 * @param cursor 服务端返回的下一批游标；未提供时请求第一批。
 * @param signal 页面离开或输入变化时用于取消旧请求的中止信号。
 * @returns 包含曲目和后续加载游标的异步分页结果。
 */
export function searchTracks(query: string, cursor?: string, signal?: AbortSignal): Promise<SearchPage> {
  const parameters = new URLSearchParams({ query, limit: '30' });
  if (cursor) parameters.set('cursor', cursor);
  return request<SearchPage>(`/api/v1/search?${parameters}`, { signal });
}

/**
 * 获取按专辑标题排序的全部专辑。
 *
 * @param limit 需要返回的专辑数量，后端当前允许的范围为 1 至 50。
 * @param cursor 服务端返回的下一批游标；未提供时请求第一批。
 * @param signal 用于在离开页面时取消未完成请求的 AbortSignal（中止信号）。
 * @returns 包含专辑与后续加载游标的 Promise（异步结果）。
 */
export function getAlbums(limit = 24, cursor?: string, signal?: AbortSignal): Promise<AlbumPage> {
  const parameters = new URLSearchParams({ limit: String(limit) });
  if (cursor) parameters.set('cursor', cursor);
  return request<AlbumPage>(`/api/v1/albums?${parameters}`, { signal });
}

/**
 * 获取按入库时间倒序排列的专辑。
 * @param limit 需要返回的专辑数量，后端当前允许的范围为 1 至 50。
 * @param cursor 服务端返回的下一批游标；未提供时请求第一批。
 * @param signal 用于在离开页面时取消未完成请求的 AbortSignal（中止信号）。
 * @returns 包含最近入库专辑的 Promise（异步结果）。
 */
export function getRecentAlbums(limit = 12, cursor?: string, signal?: AbortSignal): Promise<AlbumPage> {
  const parameters = new URLSearchParams({ limit: String(limit) });
  if (cursor) parameters.set('cursor', cursor);
  return request<AlbumPage>(`/api/v1/albums/recent?${parameters}`, { signal });
}

/**
 * 获取当前用户最近开始播放过的歌曲。
 *
 * 服务端持续保存每位用户最近 300 条播放历史；此接口仅请求首页展示所需的一小批歌曲，
 * 不返回任何播放进度。
 *
 * @param limit 需要返回的歌曲数量，后端允许范围为 1 至 50。
 * @param signal 用于在离开首页时取消未完成请求的 AbortSignal（中止信号）。
 * @returns 按最近播放顺序排列的歌曲 Promise（异步结果）。
 */
export function getRecentPlaybackTracks(limit = 12, signal?: AbortSignal): Promise<PlaybackHistoryPage> {
  const parameters = new URLSearchParams({ limit: String(limit) });
  return request<PlaybackHistoryPage>(`/api/v1/me/playback-history?${parameters}`, { signal });
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
 * 获取歌手详情及其参与的可播放专辑批次。
 * @param artistId 歌手的唯一标识。
 * @param limit 单批专辑数量，后端允许范围为 1 至 50。
 * @param cursor 服务端返回的下一批游标；未提供时请求第一批。
 * @param signal 用于在离开详情页时取消未完成请求的 AbortSignal（中止信号）。
 * @returns 包含歌手信息、当前批次专辑和后续加载游标的 Promise（异步结果）。
 */
export function getArtistDetail(artistId: string, limit = 30, cursor?: string, signal?: AbortSignal): Promise<ArtistDetail> {
  const parameters = new URLSearchParams({ limit: String(limit) });
  if (cursor) parameters.set('cursor', cursor);
  return request<ArtistDetail>(`/api/v1/artists/${encodeURIComponent(artistId)}?${parameters}`, { signal });
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
  return artworkId && !isTauriClient() ? `/api/v1/artworks/${encodeURIComponent(artworkId)}?size=${size}` : undefined;
}

export async function getArtworkSource(artworkId: string | undefined, size: 128 | 256 | 512 | 1024): Promise<string | undefined> {
  if (!artworkId) return undefined;
  const browserSource = artworkUrl(artworkId, size);
  if (browserSource) return browserSource;

  const cacheKey = resolveServerPath(`/api/v1/artworks/${encodeURIComponent(artworkId)}?size=${size}`);
  const cached = artworkObjectUrls.get(cacheKey);
  if (cached) return cached;

  const response = await apiFetch(`/api/v1/artworks/${encodeURIComponent(artworkId)}?size=${size}`);
  if (!response.ok) throw new ApiError(`封面加载失败 (${response.status})`, response.status);
  const objectUrl = URL.createObjectURL(await response.blob());
  artworkObjectUrls.set(cacheKey, objectUrl);
  return objectUrl;
}

/**
 * 检测网页音频元素和可用原生内核可直接播放的音频格式。
 *
 * @param additionalFormats - 已由原生播放器确认的附加格式；网页环境传入空数组即可。
 * @returns 格式优先级列表，供服务端选择直连音源或转码目标。
 */
function supportedAudioFormats(additionalFormats: PlaybackFormat[] = []): PlaybackFormat[] {
  const audio = document.createElement('audio');
  const candidates = [
    { container: 'm4a', codec: 'aac', mime: 'audio/mp4; codecs="mp4a.40.2"' },
    { container: 'mp4', codec: 'aac', mime: 'audio/mp4; codecs="mp4a.40.2"' },
    { container: 'mp3', codec: 'mp3', mime: 'audio/mpeg' },
    { container: 'opus', codec: 'opus', mime: 'audio/ogg; codecs="opus"' },
    { container: 'ogg', codec: 'vorbis', mime: 'audio/ogg; codecs="vorbis"' },
    { container: 'flac', codec: 'flac', mime: 'audio/flac' },
    { container: 'wav', codec: 'pcm', mime: 'audio/wav; codecs="1"' },
    { container: 'wave', codec: 'pcm', mime: 'audio/wav; codecs="1"' },
  ];
  const supported = candidates.filter((candidate) => audio.canPlayType(candidate.mime) !== '')
    .map(({ container, codec }) => ({ container, codec }));
  const browserFormats = supported.length > 0 ? supported : [{ container: 'mp3', codec: 'mp3' }];
  return [...browserFormats, ...additionalFormats];
}

/**
 * 创建一个后端授权的播放会话。
 *
 * 首次请求遵从用户的自动或限码率偏好。若服务器既不能提供该码率也无法转码，则重试
 * 一次原始音质；重试仍会使用同一份播放器格式清单，因此不会把不受支持的音源交给客户端。
 *
 * @param trackId - 要播放曲目的稳定 ID。
 * @param playerId - 当前播放器实例的稳定 ID。
 * @param quality - 用户设置导出的音质偏好与可选码率上限。
 * @param additionalFormats - 原生播放器额外支持的格式，例如 Android 的 FLAC。
 * @param clientTags - 原生客户端声明的选源标签，例如 Android 的 `android`。
 * @returns 包含已解析、且已转换为当前服务器绝对地址的播放会话。
 */
export async function createPlaybackSession(
  trackId: string,
  playerId: string,
  quality: PlaybackQualityRequest,
  additionalFormats: PlaybackFormat[] = [],
  clientTags: string[] = [],
): Promise<PlaybackSession> {
  const formats = supportedAudioFormats(additionalFormats);
  let session: PlaybackSession;
  try {
    session = await requestPlaybackSession(trackId, playerId, formats, quality, clientTags);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'playback_format_unsupported' || quality.quality === 'original') {
      throw error;
    }
    // 低码率不可用时，原始音质是唯一不依赖服务端 FFmpeg（音频转码器）的安全回退。
    session = await requestPlaybackSession(trackId, playerId, formats, { quality: 'original' }, clientTags);
  }
  return {
    ...session,
    source: { ...session.source, href: resolveServerPath(session.source.href) },
  };
}

/**
 * 向服务端提交一次播放会话解析请求。
 *
 * @param trackId - 要播放曲目的稳定 ID。
 * @param playerId - 当前播放器实例的稳定 ID。
 * @param formats - 播放内核确认支持的格式清单。
 * @param quality - 本次请求采用的音质偏好。
 * @param clientTags - 客户端运行时标签；服务端仅将其用于媒体兼容性选源。
 * @returns 服务端返回的原始播放会话；播放地址尚未转换为当前服务器绝对地址。
 */
function requestPlaybackSession(
  trackId: string,
  playerId: string,
  formats: PlaybackFormat[],
  quality: PlaybackQualityRequest,
  clientTags: string[],
): Promise<PlaybackSession> {
  return request<PlaybackSession>('/api/v1/playback/sessions', {
    method: 'POST',
    body: JSON.stringify({
      trackId,
      playerId,
      capabilities: {
        supportsByteRange: true,
        formats,
        tags: clientTags,
        ...quality,
      },
    }),
  });
}

/**
 * 上报播放器事件，并在歌曲开始播放成功持久化后通知首页刷新继续聆听。
 *
 * @param sessionId 当前播放会话的唯一标识。
 * @param type 播放器事件类型；只有 started（开始播放）会影响继续聆听历史。
 * @param positionMs 当前播放位置的毫秒值，继续聆听历史不会保存或展示该值。
 * @returns 服务端接受事件后的 Promise（异步结果）。
 */
export async function recordPlaybackEvent(
  sessionId: string,
  type: 'started' | 'progress' | 'paused' | 'ended',
  positionMs: number,
): Promise<void> {
  await request<void>(`/api/v1/playback/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({
      eventId: crypto.randomUUID(),
      type,
      positionMs: Math.max(0, Math.round(positionMs)),
      occurredAt: new Date().toISOString(),
    }),
  });
  if (type === 'started') window.dispatchEvent(new Event(playbackHistoryChangedEvent));
}

export function deletePlaybackSession(sessionId: string): Promise<void> {
  return request<void>(`/api/v1/playback/sessions/${sessionId}`, { method: 'DELETE' });
}
