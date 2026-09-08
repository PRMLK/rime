import {
  ApiError,
  createPlaybackSession,
  deletePlaybackSession,
  getArtworkSource,
  recordPlaybackEvent,
  type PlaybackSession,
  type Track,
} from '@/api/rime';
import { playbackQualityRequest, readClientSettings } from '@/lib/client-settings';
import { cacheMedia, releaseCachedMedia, resolveCachedMedia } from '@/services/media-cache';
import {
  DesktopMediaControlsBridge,
  NativePlayerBridge,
  nativeLoadRequest,
  type DesktopMediaMetadata,
  type NativePlayerStatus,
} from '@/services/player/native-player';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type PlayerSnapshot = {
  track?: Track;
  status: PlayerStatus;
  positionMs: number;
  durationMs: number;
  source?: PlaybackSession['source'];
  error?: string;
};

type Listener = () => void;

/**
 * 系统媒体界面可发出的播放指令。
 *
 * 这些指令来自通知栏、锁屏、蓝牙耳机或桌面系统媒体键。播放器本身不知道页面的
 * 队列策略，因此切歌指令会交给页面层决定下一首或上一首；播放、暂停和定位则可
 * 直接作用于当前音频元素。`toggle`（切换播放状态）由部分桌面媒体键发出，需要
 * 保留到页面层，以便根据当前实际状态调用播放器的切换逻辑。
 */
export type SystemMediaCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number };

type SystemMediaCommandListener = (command: SystemMediaCommand) => void;

export class HtmlAudioPlayer {
  private readonly audio = new Audio();
  private readonly listeners = new Set<Listener>();
  private readonly endedListeners = new Set<Listener>();
  private readonly systemMediaCommandListeners = new Set<SystemMediaCommandListener>();
  private readonly playerId = getPlayerId();
  private readonly nativePlayer = new NativePlayerBridge();
  private readonly desktopMediaControls = new DesktopMediaControlsBridge();
  private snapshot: PlayerSnapshot = { status: 'idle', positionMs: 0, durationMs: 0 };
  private session?: PlaybackSession;
  private cachedSession?: PlaybackSession;
  private loadGeneration = 0;
  private lastProgressEventAt = 0;
  private publishedMediaTrackId?: string;
  private mediaMetadataGeneration = 0;
  private isUsingNativePlayer = false;
  private isUsingDesktopMediaControls = false;
  private publishedDesktopMediaTrackId?: string;
  private desktopMediaMetadataGeneration = 0;
  private nativeProgressTimer?: ReturnType<typeof setInterval>;
  private nativeEndedNotified = false;

  constructor(private readonly cacheScope: string) {
    this.audio.preload = 'metadata';
    this.audio.addEventListener('playing', this.handlePlaying);
    this.audio.addEventListener('pause', this.handlePause);
    this.audio.addEventListener('ended', this.handleEnded);
    this.audio.addEventListener('timeupdate', this.handleTimeUpdate);
    this.audio.addEventListener('durationchange', this.handleDurationChange);
    this.audio.addEventListener('error', this.handleError);
    this.configureSystemMediaSession();
    void this.initializeDesktopMediaControls();
  }

  getSnapshot = (): PlayerSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeToEnded = (listener: Listener): (() => void) => {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  };

  /**
   * 订阅系统媒体命令。
   *
   * @param listener - 接收播放、暂停、切歌或定位指令的回调函数。
   * @returns 取消订阅函数，组件卸载时调用以避免旧页面继续响应系统媒体键。
   */
  subscribeToSystemMediaCommands = (listener: SystemMediaCommandListener): (() => void) => {
    this.systemMediaCommandListeners.add(listener);
    return () => this.systemMediaCommandListeners.delete(listener);
  };

  /**
   * 为指定曲目创建播放会话，并选择原生或网页播放内核。
   *
   * @param track - 用户请求播放的可用曲目。
   * @returns 会话已建立且播放请求已发出后的 Promise；创建或解码失败时抛出错误。
   */
  async load(track: Track): Promise<void> {
    const generation = ++this.loadGeneration;
    const wasUsingNativePlayer = this.isUsingNativePlayer;
    this.stopNativeProgressPolling();
    this.isUsingNativePlayer = false;
    this.nativeEndedNotified = false;
    this.publish({ track, status: 'loading', positionMs: 0, durationMs: track.durationMs, source: undefined, error: undefined });
    try {
      if (wasUsingNativePlayer) {
        // 先停掉旧服务，避免新请求因网络或系统限制失败时两套内核同时输出声音。
        await this.nativePlayer.stop().catch(() => undefined);
        if (generation !== this.loadGeneration) return;
      }
      const settings = readClientSettings(this.cacheScope);
      // 会话解析必须先知道原生内核是否可用；否则 FLAC 等 Android 已支持、但 WebView
      // 未声明的格式会在服务端被过早拒绝，原生播放器根本得不到加载机会。
      const useNativePlayer = await this.nativePlayer.isAvailable();
      if (generation !== this.loadGeneration) return;
      const nextSession = await createPlaybackSession(
        track.id,
        this.playerId,
        playbackQualityRequest(settings.playbackQuality),
        useNativePlayer ? this.nativePlayer.directPlaybackFormats() : [],
        this.nativePlayer.clientTags(),
      );
      if (generation !== this.loadGeneration) {
        void deletePlaybackSession(nextSession.sessionId);
        return;
      }
      const previousSession = this.session;
      this.audio.pause();
      this.session = nextSession;
      this.publish({ source: nextSession.source });
      if (useNativePlayer) {
        const previousCachedSession = this.cachedSession;
        this.cachedSession = undefined;
        this.isUsingNativePlayer = true;
        this.clearSystemMediaPresentation();
        if (previousCachedSession) {
          void releaseCachedMedia(this.cacheScope, previousCachedSession.source);
        }
        if (previousSession) {
          void deletePlaybackSession(previousSession.sessionId);
        }
        try {
          await this.nativePlayer.load(nativeLoadRequest(track, nextSession.source));
          this.startNativeProgressPolling();
          return;
        } catch {
          // 插件可用不代表本次服务一定能启动，例如设备临时拒绝前台服务。
          // 此时退回 HTMLAudioElement（网页音频元素），保证至少前台播放不中断。
          this.isUsingNativePlayer = false;
          this.synchronizeSystemMediaSession();
        }
      }
      const cachedSource = await resolveCachedMedia(this.cacheScope, nextSession.source).catch(() => undefined);
      if (generation !== this.loadGeneration) {
        if (cachedSource) void releaseCachedMedia(this.cacheScope, nextSession.source);
        void deletePlaybackSession(nextSession.sessionId);
        return;
      }
      const previousCachedSession = this.cachedSession;
      this.cachedSession = cachedSource ? nextSession : undefined;
      this.audio.src = cachedSource ?? nextSession.source.href;
      this.audio.load();
      if (previousCachedSession) {
        void releaseCachedMedia(this.cacheScope, previousCachedSession.source);
      }
      if (previousSession) {
        void deletePlaybackSession(previousSession.sessionId);
      }
      await this.audio.play();
      if (!cachedSource) {
        void cacheMedia(this.cacheScope, nextSession.source, settings.maxCacheBytes).catch(() => undefined);
      }
    } catch (error) {
      if (generation === this.loadGeneration) {
        this.publish({ status: 'error', error: messageFrom(error) });
      }
      throw error;
    }
  }

  /**
   * 根据当前状态在播放与暂停之间切换。
   *
   * @returns 播放控制命令完成后的 Promise；没有活动会话时直接结束。
   */
  async toggle(): Promise<void> {
    if (!this.session) return;
    if (this.isUsingNativePlayer) {
      try {
        const status = await this.nativePlayer.status();
        if (status.state === 'playing') {
          await this.pause();
        } else {
          await this.play();
        }
      } catch (error) {
        this.publish({ status: 'error', error: messageFrom(error) });
      }
      return;
    }
    if (this.audio.paused) {
      await this.play();
    } else {
      void this.pause();
    }
  }

  /**
   * 恢复当前曲目的播放。
   *
   * 浏览器可能因自动播放策略、音频焦点或已失效的播放源拒绝请求；这些错误必须
   * 反映到统一快照中，供页面与系统媒体界面显示可操作的失败状态。
   *
   * @returns 播放请求完成后的 Promise；没有活动会话时直接结束。
   */
  async play(): Promise<void> {
    if (!this.session) return;
    if (this.isUsingNativePlayer) {
      try {
        await this.nativePlayer.play();
        await this.refreshNativePlaybackStatus();
      } catch (error) {
        this.publish({ status: 'error', error: messageFrom(error) });
      }
      return;
    }
    try {
      await this.audio.play();
    } catch (error) {
      this.publish({ status: 'error', error: messageFrom(error) });
    }
  }

  /**
   * 暂停当前曲目。
   *
   * @returns 无返回值；浏览器的 pause 事件会统一写入播放器快照并上报播放事件。
   */
  async pause(): Promise<void> {
    if (!this.session) return;
    if (this.isUsingNativePlayer) {
      try {
        await this.nativePlayer.pause();
        await this.refreshNativePlaybackStatus();
      } catch (error) {
        this.publish({ status: 'error', error: messageFrom(error) });
      }
      return;
    }
    this.audio.pause();
  }

  /**
   * 将当前曲目跳转到指定位置。
   *
   * @param positionMs - 目标位置，单位毫秒；非法值与负值会被忽略或钳制。
   * @returns 无返回值；原生播放的异步错误会写入播放器快照。
   */
  seek(positionMs: number): void {
    if (!this.session || !Number.isFinite(positionMs)) return;
    if (this.isUsingNativePlayer) {
      void this.nativePlayer.seek(positionMs)
        .then(() => this.refreshNativePlaybackStatus())
        .catch((error: unknown) => this.publish({ status: 'error', error: messageFrom(error) }));
      return;
    }
    this.audio.currentTime = Math.max(0, positionMs) / 1000;
    this.publish({ positionMs: this.audio.currentTime * 1000 });
  }

  /**
   * 停止播放并释放当前会话、缓存引用和系统媒体状态。
   *
   * @returns 无返回值；网络侧会话删除与原生停止均不阻塞组件卸载。
   */
  dispose(): void {
    this.loadGeneration++;
    this.stopNativeProgressPolling();
    if (this.isUsingNativePlayer) {
      void this.nativePlayer.stop();
    }
    this.isUsingNativePlayer = false;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.cachedSession) {
      void releaseCachedMedia(this.cacheScope, this.cachedSession.source);
    }
    if (this.session) {
      void deletePlaybackSession(this.session.sessionId);
    }
    this.session = undefined;
    this.cachedSession = undefined;
    this.listeners.clear();
    this.endedListeners.clear();
    this.systemMediaCommandListeners.clear();
    if (this.isUsingDesktopMediaControls) {
      void this.desktopMediaControls.update({
        metadata: { durationMs: 0 },
        state: 'idle',
        positionMs: 0,
        durationMs: 0,
      }).catch(() => undefined);
    }
    this.isUsingDesktopMediaControls = false;
    this.desktopMediaControls.dispose();
    this.clearSystemMediaSession();
  }

  private publish(update: Partial<PlayerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    this.synchronizeSystemMediaSession();
    this.listeners.forEach((listener) => listener());
  }

  /**
   * 初始化 Windows/macOS 原生系统媒体面板，并把媒体键转回统一的播放器命令分发器。
   *
   * 桌面桥接层只发布网页音频播放器的快照，不能将 `isUsingNativePlayer`（使用原生播放
   * 器）设为 true；否则会错误跳过 HTMLAudioElement（网页音频元素）实际播放路径。
   *
   * @returns 无返回值；浏览器、移动端和初始化失败的桌面端继续使用 Web Media Session。
   */
  private async initializeDesktopMediaControls(): Promise<void> {
    const available = await this.desktopMediaControls.initialize((command) => this.emitSystemMediaCommand(command));
    if (!available) return;
    this.isUsingDesktopMediaControls = true;
    this.synchronizeSystemMediaSession();
  }

  /**
   * 配置网页 Media Session（媒体会话）的系统控制回调。
   *
   * 不支持该 API 的浏览器、旧 WebView 或桌面运行时会安静降级，继续使用网页内的
   * 播放控件。系统切歌命令不能由音频元素自行解释，故通过订阅器交给拥有队列的
   * 页面组件处理。
   */
  private configureSystemMediaSession(): void {
    const mediaSession = getSystemMediaSession();
    if (!mediaSession) return;

    setMediaSessionAction(mediaSession, 'play', () => void this.play());
    setMediaSessionAction(mediaSession, 'pause', () => void this.pause());
    setMediaSessionAction(mediaSession, 'nexttrack', () => this.emitSystemMediaCommand({ type: 'next' }));
    setMediaSessionAction(mediaSession, 'previoustrack', () => this.emitSystemMediaCommand({ type: 'previous' }));
    setMediaSessionAction(mediaSession, 'seekto', (details) => {
      if (typeof details.seekTime !== 'number' || !Number.isFinite(details.seekTime)) return;
      this.emitSystemMediaCommand({ type: 'seek', positionMs: details.seekTime * 1000 });
    });
  }

  /**
   * 将当前曲目、播放状态和进度同步到可用的系统媒体界面。
   *
   * 元数据只在切歌时异步读取一次封面，避免每个 timeupdate（进度更新）重复下载
   * 图片；进度和播放状态则需要持续更新，使锁屏和桌面系统控件显示正确时间。
   */
  private synchronizeSystemMediaSession(): void {
    if (this.isUsingNativePlayer) {
      // Android/iOS 已由原生 MediaSession/Now Playing 展示控件，不能同时保留 WebView 会话。
      this.clearSystemMediaPresentation();
      return;
    }
    if (this.isUsingDesktopMediaControls) {
      // Windows/macOS 改由原生 SMTC/Now Playing 展示，避免 WebView 与系统桥接层争夺媒体键。
      this.clearSystemMediaPresentation();
      this.synchronizeDesktopMediaControls();
      return;
    }

    const mediaSession = getSystemMediaSession();
    if (!mediaSession) return;

    const track = this.snapshot.track;
    if (!track) {
      this.publishedMediaTrackId = undefined;
      this.mediaMetadataGeneration++;
      mediaSession.metadata = null;
      mediaSession.playbackState = 'none';
      clearMediaSessionPosition(mediaSession);
      return;
    }

    if (this.publishedMediaTrackId !== track.id) {
      this.publishedMediaTrackId = track.id;
      const generation = ++this.mediaMetadataGeneration;
      this.publishSystemMediaMetadata(track);
      void getArtworkSource(track.artworkId, 512)
        .then((artworkUrl) => {
          // 异步封面可能在切歌后才返回；只允许仍为当前曲目的结果覆盖元数据。
          if (generation === this.mediaMetadataGeneration && this.snapshot.track?.id === track.id) {
            this.publishSystemMediaMetadata(track, artworkUrl);
          }
        })
        .catch(() => undefined);
    }

    mediaSession.playbackState = this.snapshot.status === 'playing'
      ? 'playing'
      : this.snapshot.status === 'idle'
        ? 'none'
        : 'paused';
    synchronizeMediaSessionPosition(mediaSession, this.snapshot.positionMs, this.snapshot.durationMs);
  }

  /**
   * 将网页音频播放器的快照发布给 Windows SMTC（系统媒体传输控件）或 macOS Now Playing。
   *
   * 元数据仅在切歌、封面读取完成和清理时提交，进度则随播放事件更新。这个分离避免
   * macOS 每个 `timeupdate`（进度更新）都重新读取封面，同时保证系统时间轴持续移动。
   *
   * @returns 无返回值；底层 IPC（进程间通信）失败会恢复网页 Media Session 回退路径。
   */
  private synchronizeDesktopMediaControls(): void {
    const track = this.snapshot.track;
    if (!track) {
      if (this.publishedDesktopMediaTrackId !== undefined) {
        this.publishedDesktopMediaTrackId = undefined;
        this.desktopMediaMetadataGeneration++;
        this.publishDesktopMediaUpdate({ durationMs: 0 });
      } else {
        this.publishDesktopMediaUpdate();
      }
      return;
    }

    const isNewTrack = this.publishedDesktopMediaTrackId !== track.id;
    if (isNewTrack) {
      this.publishedDesktopMediaTrackId = track.id;
      const generation = ++this.desktopMediaMetadataGeneration;
      this.publishDesktopMediaUpdate(this.desktopMediaMetadata(track));
      void getArtworkSource(track.artworkId, 512)
        .then((source) => artworkDataUrl(source))
        .then((dataUrl) => {
          // 封面读取是异步的；只允许仍属于当前曲目的结果覆盖系统媒体面板。
          if (dataUrl && generation === this.desktopMediaMetadataGeneration && this.snapshot.track?.id === track.id) {
            this.publishDesktopMediaUpdate(this.desktopMediaMetadata(track, dataUrl));
          }
        })
        .catch(() => undefined);
      return;
    }

    this.publishDesktopMediaUpdate();
  }

  /**
   * 构建一次原生桌面媒体面板的曲目元数据。
   *
   * @param track 当前网页音频播放器的曲目。
   * @param artworkDataUrl 已转换为 data URL（数据 URL）的封面；未就绪时可省略。
   * @returns 不含播放源和鉴权令牌的安全系统媒体元数据。
   */
  private desktopMediaMetadata(track: Track, artworkDataUrl?: string): DesktopMediaMetadata {
    return {
      title: track.title,
      artist: track.artists.map((artist) => artist.name).join(' / '),
      album: track.album.title,
      artworkDataUrl,
      durationMs: track.durationMs,
    };
  }

  /**
   * 异步发布桌面媒体面板更新，并在桥接层失效时回退到网页 Media Session。
   *
   * @param metadata 可选曲目元数据；undefined 表示仅更新播放状态和进度。
   * @returns 无返回值；失败处理不应阻塞或中断当前网页音频。
   */
  private publishDesktopMediaUpdate(metadata?: DesktopMediaMetadata): void {
    void this.desktopMediaControls.update({
      metadata,
      state: this.snapshot.status,
      positionMs: Math.max(0, Math.round(this.snapshot.positionMs)),
      durationMs: Math.max(0, Math.round(this.snapshot.durationMs)),
    }).catch(() => {
      if (!this.isUsingDesktopMediaControls) return;
      this.isUsingDesktopMediaControls = false;
      this.desktopMediaControls.dispose();
      this.synchronizeSystemMediaSession();
    });
  }

  /**
   * 写入曲目标题、艺人、专辑和可选封面。
   *
   * @param track - 当前正在加载或播放的曲目元数据。
   * @param artworkUrl - 已解析的封面 URL；未提供时先显示文字元数据，避免等待图片。
   */
  private publishSystemMediaMetadata(track: Track, artworkUrl?: string): void {
    const mediaSession = getSystemMediaSession();
    if (!mediaSession || typeof MediaMetadata === 'undefined') return;
    mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artists.map((artist) => artist.name).join(' / '),
      album: track.album.title,
      artwork: artworkUrl ? [{ src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }] : undefined,
    });
  }

  /**
   * 向页面层广播系统媒体命令。
   *
   * @param command - 已由锁屏、通知栏、耳机或桌面媒体键触发的指令。
   * @returns 无返回值；每个订阅器负责在自己的队列上下文中执行命令。
   */
  private emitSystemMediaCommand(command: SystemMediaCommand): void {
    this.systemMediaCommandListeners.forEach((listener) => listener(command));
  }

  /**
   * 释放网页媒体会话的元数据与回调。
   *
   * 组件切换账户或卸载时必须清除，否则系统控制中心可能保留已停止曲目的封面和按钮。
   */
  private clearSystemMediaSession(): void {
    const mediaSession = getSystemMediaSession();
    if (!mediaSession) return;
    this.clearSystemMediaPresentation();
    for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto'] as const) {
      setMediaSessionAction(mediaSession, action, null);
    }
  }

  /**
   * 清除网页媒体会话的可见状态，但保留命令处理器。
   *
   * 原生移动播放器启用时必须避免 Android 同时显示 WebView 和 Media3 两个媒体通知；
   * 保留处理器可让旧安装包或桌面端回退到网页引擎时立即继续响应系统媒体键。
   */
  private clearSystemMediaPresentation(): void {
    const mediaSession = getSystemMediaSession();
    if (!mediaSession) return;
    this.publishedMediaTrackId = undefined;
    this.mediaMetadataGeneration++;
    mediaSession.metadata = null;
    mediaSession.playbackState = 'none';
    clearMediaSessionPosition(mediaSession);
  }

  /**
   * 启动原生播放状态轮询。
   *
   * Android/iOS 在后台时无需 WebView 参与即可继续播放；页面恢复或仍在前台时，通过
   * 轻量轮询把原生服务的进度、暂停和结束状态同步回 React，复用现有队列与统计逻辑。
   */
  private startNativeProgressPolling(): void {
    this.stopNativeProgressPolling();
    void this.refreshNativePlaybackStatus();
    this.nativeProgressTimer = setInterval(() => void this.refreshNativePlaybackStatus(), 1_000);
  }

  /**
   * 停止原生播放状态轮询。
   *
   * 切歌、回退到网页播放器或组件卸载时必须清理计时器，避免旧播放器把过期状态写回
   * 新曲目快照。
   */
  private stopNativeProgressPolling(): void {
    if (this.nativeProgressTimer) {
      clearInterval(this.nativeProgressTimer);
      this.nativeProgressTimer = undefined;
    }
  }

  /**
   * 从原生插件读取一次播放状态。
   *
   * @returns 无返回值；插件失联时仅在仍处于原生模式下向页面公布错误，防止旧异步请求
   * 覆盖已经切回网页播放器的新状态。
   */
  private async refreshNativePlaybackStatus(): Promise<void> {
    if (!this.isUsingNativePlayer) return;
    try {
      const status = await this.nativePlayer.status();
      if (this.isUsingNativePlayer) this.applyNativePlaybackStatus(status);
    } catch (error) {
      if (this.isUsingNativePlayer) this.publish({ status: 'error', error: messageFrom(error) });
    }
  }

  /**
   * 将原生服务状态转换为现有页面播放器快照。
   *
   * @param status Android/iOS 返回的状态、位置和错误信息。
   * @returns 无返回值；结束事件只发出一次，避免轮询反复触发自动切歌。
   */
  private applyNativePlaybackStatus(status: NativePlayerStatus): void {
    const previousStatus = this.snapshot.status;
    const durationMs = status.durationMs > 0 ? status.durationMs : this.snapshot.durationMs;
    const positionMs = Math.max(0, status.positionMs);
    if (status.state === 'ended') {
      this.publish({ status: 'paused', positionMs: durationMs, durationMs, error: undefined });
      if (!this.nativeEndedNotified) {
        this.nativeEndedNotified = true;
        this.report('ended', durationMs);
        this.endedListeners.forEach((listener) => listener());
      }
      return;
    }
    const nextStatus: PlayerStatus = status.state === 'playing'
      ? 'playing'
      : status.state === 'loading'
        ? 'loading'
        : status.state === 'error'
          ? 'error'
          : status.state === 'idle'
            ? 'idle'
            : 'paused';
    this.publish({ status: nextStatus, positionMs, durationMs, error: status.error });
    if (nextStatus === 'playing') {
      if (previousStatus !== 'playing') this.report('started', positionMs);
      const now = Date.now();
      if (now - this.lastProgressEventAt >= 15_000) {
        this.lastProgressEventAt = now;
        this.report('progress', positionMs);
      }
    } else if (nextStatus === 'paused' && previousStatus === 'playing') {
      this.report('paused', positionMs);
    }
  }

  /**
   * 向服务器上报播放生命周期事件。
   *
   * @param type 事件类别。
   * @param positionMs 可选的原生播放位置；网页播放器未提供时读取 Audio 元素当前位置。
   * @returns 无返回值；统计上报不得阻塞或中断用户播放。
   */
  private report(type: 'started' | 'progress' | 'paused' | 'ended', positionMs?: number): void {
    if (!this.session) return;
    void recordPlaybackEvent(this.session.sessionId, type, positionMs ?? this.audio.currentTime * 1000);
  }

  private handlePlaying = (): void => {
    if (this.isUsingNativePlayer) return;
    this.publish({ status: 'playing', error: undefined });
    this.report('started');
  };

  private handlePause = (): void => {
    if (this.isUsingNativePlayer) return;
    if (!this.audio.ended && this.session) {
      this.publish({ status: 'paused' });
      this.report('paused');
    }
  };

  private handleEnded = (): void => {
    if (this.isUsingNativePlayer) return;
    this.publish({ status: 'paused', positionMs: this.snapshot.durationMs });
    this.report('ended');
    this.endedListeners.forEach((listener) => listener());
  };

  private handleTimeUpdate = (): void => {
    if (this.isUsingNativePlayer) return;
    const now = Date.now();
    this.publish({ positionMs: this.audio.currentTime * 1000 });
    if (now - this.lastProgressEventAt >= 15_000) {
      this.lastProgressEventAt = now;
      this.report('progress');
    }
  };

  private handleDurationChange = (): void => {
    if (this.isUsingNativePlayer) return;
    if (Number.isFinite(this.audio.duration)) {
      this.publish({ durationMs: this.audio.duration * 1000 });
    }
  };

  private handleError = (): void => {
    if (this.isUsingNativePlayer) return;
    this.publish({ status: 'error', error: '音频加载失败' });
  };
}

/**
 * 取得当前运行时支持的网页媒体会话。
 *
 * @returns 浏览器实现的 MediaSession；SSR、旧浏览器或受限 WebView 中返回 undefined。
 */
function getSystemMediaSession(): MediaSession | undefined {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return undefined;
  return navigator.mediaSession;
}

/**
 * 安全设置或移除单个媒体命令处理器。
 *
 * 某些 WebView 虽暴露 MediaSession，却不支持全部 action；逐项吞掉不支持异常可以
 * 让播放和暂停等基础能力仍然可用。
 *
 * @param mediaSession - 当前浏览器提供的媒体会话。
 * @param action - 要注册的标准媒体动作。
 * @param handler - 动作回调；传入 null 时移除已有回调。
 * @returns 无返回值。
 */
function setMediaSessionAction(
  mediaSession: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    mediaSession.setActionHandler(action, handler);
  } catch {
    // WebView 对可选系统动作的支持不完整，不能让此问题中断实际音频播放。
  }
}

/**
 * 同步系统进度条。
 *
 * @param mediaSession - 当前浏览器提供的媒体会话。
 * @param positionMs - 当前播放位置，单位毫秒。
 * @param durationMs - 曲目总时长，单位毫秒。
 * @returns 无返回值；未知或非法时清除系统进度，避免浏览器抛出范围异常。
 */
function synchronizeMediaSessionPosition(mediaSession: MediaSession, positionMs: number, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(positionMs)) {
    clearMediaSessionPosition(mediaSession);
    return;
  }
  try {
    mediaSession.setPositionState({
      duration: durationMs / 1000,
      position: Math.min(Math.max(positionMs, 0), durationMs) / 1000,
      playbackRate: 1,
    });
  } catch {
    // 浏览器可能拒绝边界进度；此时保留标题和控制按钮即可。
  }
}

/**
 * 清除系统进度条状态。
 *
 * @param mediaSession - 当前浏览器提供的媒体会话。
 * @returns 无返回值。
 */
function clearMediaSessionPosition(mediaSession: MediaSession): void {
  try {
    mediaSession.setPositionState();
  } catch {
    // 旧实现可能没有 setPositionState；元数据和基本控制不受影响。
  }
}

/**
 * 将已由 WebView 鉴权取得的封面地址转换为可传给 Rust 的 data URL（数据 URL）。
 *
 * Tauri 桌面端的封面通常是 blob URL（对象 URL），Windows 和 macOS 系统进程无法访问
 * 该地址。转换结果会由 Rust 写入应用缓存，再以 file URL（文件 URL）交给系统媒体面板。
 *
 * @param source 浏览器或 WebView 可读取的封面地址。
 * @returns 最大 5 MiB 的图片 data URL；无封面、读取失败或过大时返回 undefined。
 */
async function artworkDataUrl(source: string | undefined): Promise<string | undefined> {
  if (!source) return undefined;
  const response = await fetch(source);
  if (!response.ok) return undefined;
  const artwork = await response.blob();
  if (!artwork.type.startsWith('image/') || artwork.size > 5 * 1024 * 1024) return undefined;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(typeof reader.result === 'string' ? reader.result : undefined), { once: true });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('封面读取失败')), { once: true });
    reader.readAsDataURL(artwork);
  });
}

function getPlayerId(): string {
  const key = 'rime.playerId';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const playerId = `web-${crypto.randomUUID()}`;
    localStorage.setItem(key, playerId);
    return playerId;
  } catch {
    return `web-${crypto.randomUUID()}`;
  }
}

/**
 * 将播放器底层错误转换为适合直接呈现给用户的中文提示。
 *
 * @param error - API（应用程序接口）、原生播放器或浏览器音频元素抛出的未知错误。
 * @returns 可在播放器界面展示的简洁错误文案；已知的服务端错误码会返回对应的处理建议。
 */
function messageFrom(error: unknown): string {
  if (error instanceof ApiError && error.code === 'playback_format_unsupported') {
    return '当前音源无法直接播放，服务器也未启用音频转码。请联系管理员配置 FFmpeg 后重试。';
  }
  return error instanceof Error ? error.message : '播放失败';
}
