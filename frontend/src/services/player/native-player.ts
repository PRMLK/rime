import { invoke, isTauri } from '@tauri-apps/api/core';
import type { PlaybackFormat, PlaybackSession, Track } from '@/api/rime';

/** 原生播放服务能返回的状态；`ended` 用于让前端延续既有队列策略。 */
export type NativePlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

/** 原生播放服务的状态快照。 */
export type NativePlayerStatus = {
  available: boolean;
  state: NativePlayerState;
  positionMs: number;
  durationMs: number;
  error?: string;
};

/**
 * 将后端会话和曲目数据转换为原生播放器请求。
 *
 * 原生服务只接收短期播放会话 URL，不会取得或持久化用户的 Bearer token（持有者令牌）。
 */
export type NativePlayerLoadRequest = {
  sourceUrl: string;
  contentType?: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  startPositionMs: number;
};

const pluginCommandPrefix = 'plugin:rime-player|';

/**
 * Tauri 原生播放器插件的 TypeScript 门面。
 *
 * 插件不存在、运行在浏览器中或桌面端明确返回不可用时，调用方会保留 HTMLAudioElement
 * 回退路径。这样旧安装包和 Web 版本不会因新原生能力尚未部署而无法播放。
 */
export class NativePlayerBridge {
  private availability?: Promise<boolean>;

  /**
   * 判断当前安装包是否包含可用的移动端原生播放器。
   *
   * @returns Android/iOS 原生插件成功响应时为 true，网页、桌面或旧安装包中为 false。
   */
  async isAvailable(): Promise<boolean> {
    if (!isTauri()) return false;
    this.availability ??= this.status()
      .then((status) => status.available)
      .catch(() => false);
    return this.availability;
  }

  /**
   * 返回当前原生播放器可安全声明给服务端的额外直连格式。
   *
   * Android 8.1（API 27）及以上的 Media3/ExoPlayer 可直接解码 FLAC；该格式不应由
   * WebView 的 `canPlayType`（格式探测）代替判断。iOS 和较早 Android 版本保持空列表，
   * 继续使用服务端转码或网页内核的兼容路径。
   *
   * @returns 可附加到播放会话能力清单的格式数组；调用方应先确认 `isAvailable()` 为 true。
   */
  directPlaybackFormats(): PlaybackFormat[] {
    return supportsAndroidNativeFlac() ? [{ container: 'flac', codec: 'flac' }] : [];
  }

  /**
   * 读取原生服务的当前播放状态。
   *
   * @returns 原生服务快照；插件通信失败会向调用方抛出，以便区分真实播放失败和回退场景。
   */
  async status(): Promise<NativePlayerStatus> {
    return invoke<NativePlayerStatus>(`${pluginCommandPrefix}status`);
  }

  /**
   * 加载并开始播放一个后端已授权的媒体源。
   *
   * @param request 包含播放 URL、系统媒体界面元数据和起播位置的请求。
   * @returns 原生命令完成后的 Promise；实际缓冲进度由后续 status 查询取得。
   */
  async load(request: NativePlayerLoadRequest): Promise<void> {
    await invoke(`${pluginCommandPrefix}load`, { request });
  }

  /** 恢复原生播放器当前曲目。 */
  async play(): Promise<void> {
    await invoke(`${pluginCommandPrefix}play`);
  }

  /** 暂停原生播放器当前曲目。 */
  async pause(): Promise<void> {
    await invoke(`${pluginCommandPrefix}pause`);
  }

  /**
   * 定位原生播放器。
   *
   * @param positionMs 目标位置，单位毫秒；负数会被钳制为零。
   * @returns 原生命令完成后的 Promise。
   */
  async seek(positionMs: number): Promise<void> {
    await invoke(`${pluginCommandPrefix}seek`, {
      request: { positionMs: Math.max(0, Math.round(positionMs)) },
    });
  }

  /** 停止原生播放器并撤销后台播放服务。 */
  async stop(): Promise<void> {
    await invoke(`${pluginCommandPrefix}stop`);
  }
}

/**
 * 根据现有 API（应用程序接口）对象构建原生加载请求。
 *
 * @param track 当前要播放的曲目。
 * @param source 后端返回的短期播放源。
 * @param startPositionMs 恢复播放时的起始位置，单位毫秒。
 * @returns 供 Android 或 iOS 插件解析的稳定序列化对象。
 */
export function nativeLoadRequest(
  track: Track,
  source: PlaybackSession['source'],
  startPositionMs = 0,
): NativePlayerLoadRequest {
  return {
    sourceUrl: source.href,
    contentType: source.contentType,
    title: track.title,
    artist: track.artists.map((artist) => artist.name).join(' / '),
    album: track.album.title,
    durationMs: track.durationMs,
    startPositionMs: Math.max(0, Math.round(startPositionMs)),
  };
}

/**
 * 判断当前 Android WebView 是否运行在具备系统 FLAC 解码保证的版本上。
 *
 * @returns Android 8.1（API 27）及以上时为 true；无法识别或非 Android 环境时为 false。
 */
function supportsAndroidNativeFlac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const version = /\bAndroid\s+(\d+)(?:\.(\d+))?/i.exec(navigator.userAgent);
  if (!version) return false;
  const major = Number(version[1]);
  const minor = Number(version[2] ?? '0');
  return major > 8 || (major === 8 && minor >= 1);
}
