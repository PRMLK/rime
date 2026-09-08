import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
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
const desktopMediaCommandEvent = 'rime-player://desktop-media-command';

/** Windows/macOS 原生媒体面板所需的曲目元数据。 */
export type DesktopMediaMetadata = {
  title?: string;
  artist?: string;
  album?: string;
  /** 已由 WebView 完成鉴权读取的封面 data URL（数据 URL）。 */
  artworkDataUrl?: string;
  durationMs: number;
};

/** 网页音频播放器向 Windows/macOS 原生媒体面板同步的状态。 */
export type DesktopMediaUpdate = {
  /** 仅在切歌、封面就绪或清空系统面板时提供，普通进度更新保持 undefined。 */
  metadata?: DesktopMediaMetadata;
  state: NativePlayerState;
  positionMs: number;
  durationMs: number;
};

/** 原生 Windows/macOS 媒体键发回网页播放器的指令。 */
export type DesktopMediaCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number };

/**
 * Tauri 原生播放器插件的 TypeScript 门面。
 *
 * 插件不存在、运行在浏览器中或桌面端明确返回不可用时，调用方会保留 HTMLAudioElement
 * 回退路径。这样旧安装包和 Web 版本不会因新原生能力尚未部署而无法播放。
 */
export class NativePlayerBridge {
  private availability?: Promise<boolean>;

  /**
   * 返回当前原生运行时必须随播放会话上传的服务端选源标签。
   *
   * 仅 Tauri 打包应用发送平台标签，普通浏览器不携带标签。服务端据此固定返回原生
   * 播放器稳定支持的 M4A/AAC 播放源，避免 WebView 的格式探测结果影响原生服务选源。
   *
   * @returns Android、iOS、Windows 或 macOS 原生运行时返回对应单一标签；其他环境为空。
   */
  clientTags(): string[] {
    if (!isTauri()) return [];
    if (isAndroidRuntime()) return ['android'];
    if (isIOSRuntime()) return ['ios'];
    if (isWindowsRuntime()) return ['windows'];
    if (isMacOSRuntime()) return ['macos'];
    return [];
  }

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
 * Windows/macOS 系统媒体面板的 TypeScript 门面。
 *
 * 这不是原生音频播放器，不能影响 `NativePlayerBridge`（原生播放器桥）的可用性判断。
 * 音频仍由 HTMLAudioElement（网页音频元素）输出，桥接层只负责将同一份播放快照发布
 * 给 Windows SMTC（系统媒体传输控件）或 macOS Now Playing（正在播放），并收回媒体键。
 */
export class DesktopMediaControlsBridge {
  private unlisten?: UnlistenFn;

  /**
   * 注册原生媒体键事件并尝试创建桌面系统媒体面板。
   *
   * 先安装前端监听器，再请求 Rust（Rust 编程语言）侧创建控制器，保证初始化完成瞬间
   * 按下媒体键也不会丢失。浏览器、移动端和不支持的桌面系统都会安静返回 false。
   *
   * @param listener 接收播放、暂停、切歌或绝对定位命令的回调函数。
   * @returns 原生系统媒体面板创建成功时为 true，否则为 false。
   */
  async initialize(listener: (command: DesktopMediaCommand) => void): Promise<boolean> {
    if (!isTauri() || this.unlisten) return Boolean(this.unlisten);
    let unlisten: UnlistenFn | undefined;
    try {
      unlisten = await listen<unknown>(desktopMediaCommandEvent, (event) => {
        const command = parseDesktopMediaCommand(event.payload);
        if (command) listener(command);
      });
      const available = await invoke<boolean>(`${pluginCommandPrefix}desktop_media_controls_available`);
      if (!available) {
        unlisten();
        return false;
      }
      this.unlisten = unlisten;
      return true;
    } catch {
      unlisten?.();
      return false;
    }
  }

  /**
   * 把网页音频的当前曲目、播放状态和进度发布给原生系统媒体面板。
   *
   * @param update 不包含播放 URL 或令牌的桌面媒体快照。
   * @returns 原生 IPC（进程间通信）完成后的 Promise；调用方应在失败时回退到 Web Media Session。
   */
  async update(update: DesktopMediaUpdate): Promise<void> {
    await invoke(`${pluginCommandPrefix}update_desktop_media_controls`, { update });
  }

  /**
   * 取消对 Tauri 原生媒体键事件的监听。
   *
   * @returns 无返回值；应用退出时 Rust 侧控制器会随进程释放。
   */
  dispose(): void {
    this.unlisten?.();
    this.unlisten = undefined;
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
  if (!isAndroidRuntime()) return false;
  const version = /\bAndroid\s+(\d+)(?:\.(\d+))?/i.exec(navigator.userAgent);
  if (!version) return false;
  const major = Number(version[1]);
  const minor = Number(version[2] ?? '0');
  return major > 8 || (major === 8 && minor >= 1);
}

/**
 * 判断当前 WebView 是否运行在 Android 系统上。
 *
 * @returns 用户代理明确包含 Android 时返回 true；服务端渲染等无浏览器环境返回 false。
 */
function isAndroidRuntime(): boolean {
  return typeof navigator !== 'undefined' && /\bAndroid\b/i.test(navigator.userAgent);
}

/**
 * 判断当前 WebView 是否运行在 iOS 系统上。
 *
 * @returns 用户代理明确属于 iPhone、iPad 或 iPod 时返回 true。
 */
function isIOSRuntime(): boolean {
  return typeof navigator !== 'undefined' && /\b(iPhone|iPad|iPod)\b/i.test(navigator.userAgent);
}

/**
 * 判断当前原生壳是否运行在 Windows 系统上。
 *
 * @returns 用户代理包含 Windows NT 时返回 true。
 */
function isWindowsRuntime(): boolean {
  return typeof navigator !== 'undefined' && /\bWindows NT\b/i.test(navigator.userAgent);
}

/**
 * 判断当前原生壳是否运行在 macOS 系统上。
 *
 * iOS 的用户代理可能包含 Macintosh，必须在 clientTags（客户端标签）中优先完成 iOS 判断。
 *
 * @returns 用户代理包含 Macintosh 或 Mac OS X 时返回 true。
 */
function isMacOSRuntime(): boolean {
  return typeof navigator !== 'undefined' && /\b(Macintosh|Mac OS X)\b/i.test(navigator.userAgent);
}

/**
 * 校验并转换 Tauri 事件负载，避免未知原生事件影响播放器队列。
 *
 * @param payload Tauri 事件总线传来的未知 JSON（JavaScript 对象表示法）数据。
 * @returns 合法的桌面媒体命令；字段缺失、类型错误或越界时返回 undefined。
 */
function parseDesktopMediaCommand(payload: unknown): DesktopMediaCommand | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const { type, positionMs } = payload as { type?: unknown; positionMs?: unknown };
  if (type === 'play' || type === 'pause' || type === 'toggle' || type === 'next' || type === 'previous') {
    return { type };
  }
  if (type === 'seek' && typeof positionMs === 'number' && Number.isFinite(positionMs) && positionMs >= 0) {
    return { type, positionMs };
  }
  return undefined;
}
