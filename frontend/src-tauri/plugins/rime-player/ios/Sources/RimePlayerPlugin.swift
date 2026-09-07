import AVFoundation
import MediaPlayer
import Tauri

/** 前端传递给 AVPlayer（Apple 播放器）的播放源与媒体元数据。 */
private final class PlaybackLoadRequest: Decodable {
  let sourceUrl: String
  let contentType: String?
  let title: String
  let artist: String
  let album: String
  let durationMs: UInt64
  let startPositionMs: UInt64
}

/** 前端传递给原生播放器的毫秒级定位参数。 */
private final class PlaybackSeekRequest: Decodable {
  let positionMs: UInt64
}

/**
 * 统一 iOS 原生播放内核。
 *
 * 该对象独立于 WKWebView（网页视图）持有 AVPlayer、Audio Session（音频会话）和
 * Remote Command Center（远程命令中心）。应用进入后台后，系统仍能通过它更新锁屏与
 * 控制中心并继续播放。
 */
private final class PlaybackCoordinator {
  static let shared = PlaybackCoordinator()

  private var player: AVPlayer?
  private var timeObserver: Any?
  private var endObserver: NSObjectProtocol?
  private var currentTitle = ""
  private var currentArtist = ""
  private var currentAlbum = ""
  private var expectedDurationMs: UInt64 = 0
  private var playbackError: String?
  private var reachedEnd = false
  private var remoteCommandsConfigured = false

  /**
   * 准备一首新歌并开始播放。
   *
   * @param request 后端会话 URL、曲目元数据和可选起播位置。
   * @throws URL 或音频会话不可用时抛出错误，由 Tauri 返回给网页层。
   */
  func load(_ request: PlaybackLoadRequest) throws {
    guard let url = URL(string: request.sourceUrl) else {
      throw NSError(domain: "RimePlayer", code: 1, userInfo: [NSLocalizedDescriptionKey: "播放地址无效"])
    }
    try configureAudioSession()
    stopPlayer(clearNowPlaying: false)
    currentTitle = request.title
    currentArtist = request.artist
    currentAlbum = request.album
    expectedDurationMs = request.durationMs
    playbackError = nil
    reachedEnd = false
    let nextPlayer = AVPlayer(url: url)
    player = nextPlayer
    configureRemoteCommands()
    addProgressObserver(to: nextPlayer)
    addEndObserver(to: nextPlayer)
    if request.startPositionMs > 0 {
      nextPlayer.seek(to: CMTime(value: CMTimeValue(request.startPositionMs), timescale: 1000))
    }
    nextPlayer.play()
    updateNowPlayingInfo()
  }

  /** 恢复当前播放器并刷新控制中心的播放速率。 */
  func play() {
    reachedEnd = false
    player?.play()
    updateNowPlayingInfo()
  }

  /** 暂停当前播放器并刷新控制中心的播放速率。 */
  func pause() {
    player?.pause()
    updateNowPlayingInfo()
  }

  /**
   * 跳转到请求的位置。
   *
   * @param positionMs 目标位置，单位毫秒；播放器会在可用时长范围内自动处理边界。
   */
  func seek(to positionMs: UInt64) {
    reachedEnd = false
    player?.seek(to: CMTime(value: CMTimeValue(positionMs), timescale: 1000))
    updateNowPlayingInfo()
  }

  /** 停止播放、清空系统正在播放信息并停用音频会话。 */
  func stop() {
    stopPlayer(clearNowPlaying: true)
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  /**
   * 导出当前快照供 WebView 恢复前台时同步。
   *
   * @returns 包含状态、进度和潜在错误的 JSON 兼容字典。
   */
  func status() -> [String: Any] {
    let activePlayer = player
    let state: String
    if activePlayer == nil {
      state = "idle"
    } else if playbackError != nil {
      state = "error"
    } else if reachedEnd {
      state = "ended"
    } else if activePlayer?.timeControlStatus == .waitingToPlayAtSpecifiedRate {
      state = "loading"
    } else if activePlayer?.timeControlStatus == .playing {
      state = "playing"
    } else {
      state = "paused"
    }
    let positionMs = milliseconds(activePlayer?.currentTime() ?? .zero)
    let durationMs = durationMilliseconds(activePlayer) ?? expectedDurationMs
    return [
      "available": true,
      "state": state,
      "positionMs": positionMs,
      "durationMs": durationMs,
      "error": playbackError as Any,
    ]
  }

  /**
   * 把音频会话配置为长期媒体播放。
   *
   * @throws AVAudioSession 拒绝激活时抛出，调用方不得假装后台能力已启用。
   */
  private func configureAudioSession() throws {
    let audioSession = AVAudioSession.sharedInstance()
    try audioSession.setCategory(.playback, mode: .default, options: [.allowAirPlay, .allowBluetoothA2DP])
    try audioSession.setActive(true)
  }

  /**
   * 注册一次系统播放、暂停和定位命令。
   *
   * 下一首和上一首依赖跨端队列同步，首版不伪装支持它们，避免锁屏点击后无响应。
   */
  private func configureRemoteCommands() {
    guard !remoteCommandsConfigured else { return }
    remoteCommandsConfigured = true
    let commandCenter = MPRemoteCommandCenter.shared()
    commandCenter.playCommand.addTarget { [weak self] _ in
      self?.play()
      return .success
    }
    commandCenter.pauseCommand.addTarget { [weak self] _ in
      self?.pause()
      return .success
    }
    commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let positionEvent = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      self?.seek(to: UInt64(max(0, positionEvent.positionTime) * 1000))
      return .success
    }
    commandCenter.nextTrackCommand.isEnabled = false
    commandCenter.previousTrackCommand.isEnabled = false
  }

  /**
   * 添加周期性进度观察器，使控制中心不需要唤醒 WebView 也能显示准确时间。
   *
   * @param nextPlayer 即将成为当前播放器的 AVPlayer。
   */
  private func addProgressObserver(to nextPlayer: AVPlayer) {
    let interval = CMTime(value: 1, timescale: 1)
    timeObserver = nextPlayer.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] _ in
      self?.updateNowPlayingInfo()
    }
  }

  /**
   * 监听当前媒体项的自然结束事件。
   *
   * AVPlayer 在播放结束后通常只呈现 paused（暂停）状态；显式记录 ended（结束）能让
   * WebView 恢复前台后沿用既有队列策略自动加载下一首。
   *
   * @param nextPlayer 当前新建的播放器。
   */
  private func addEndObserver(to nextPlayer: AVPlayer) {
    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime,
      object: nextPlayer.currentItem,
      queue: .main,
    ) { [weak self] _ in
      self?.reachedEnd = true
      self?.updateNowPlayingInfo()
    }
  }

  /**
   * 写入锁屏与控制中心所需的正在播放元数据、进度和播放速率。
   * 远程封面因当前后端封面接口需要认证，首版不会把长期 Token（令牌）暴露给系统 URL。
   */
  private func updateNowPlayingInfo() {
    guard player != nil else {
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
      return
    }
    let positionMs = milliseconds(player?.currentTime() ?? .zero)
    let durationMs = durationMilliseconds(player) ?? expectedDurationMs
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [
      MPMediaItemPropertyTitle: currentTitle,
      MPMediaItemPropertyArtist: currentArtist,
      MPMediaItemPropertyAlbumTitle: currentAlbum,
      MPMediaItemPropertyPlaybackDuration: Double(durationMs) / 1000,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: Double(positionMs) / 1000,
      MPNowPlayingInfoPropertyPlaybackRate: player?.timeControlStatus == .playing ? 1 : 0,
    ]
  }

  /**
   * 移除旧观察器和播放器。
   *
   * @param clearNowPlaying 是否同时清除锁屏与控制中心信息；切歌时应保留至新元数据写入。
   */
  private func stopPlayer(clearNowPlaying: Bool) {
    if let observer = timeObserver, let currentPlayer = player {
      currentPlayer.removeTimeObserver(observer)
    }
    timeObserver = nil
    if let observer = endObserver {
      NotificationCenter.default.removeObserver(observer)
    }
    endObserver = nil
    reachedEnd = false
    player?.pause()
    player = nil
    if clearNowPlaying {
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
  }

  /** @returns Core Media 时间值转换后的非负毫秒数。 */
  private func milliseconds(_ time: CMTime) -> UInt64 {
    guard time.isValid, time.seconds.isFinite else { return 0 }
    return UInt64(max(0, time.seconds) * 1000)
  }

  /** @returns 当前项目时长；流媒体尚未知晓总时长时返回 nil。 */
  private func durationMilliseconds(_ activePlayer: AVPlayer?) -> UInt64? {
    guard let duration = activePlayer?.currentItem?.duration,
          duration.isValid,
          duration.seconds.isFinite,
          duration.seconds >= 0 else { return nil }
    return UInt64(duration.seconds * 1000)
  }
}

/** Tauri 的 iOS 原生插件入口。 */
final class RimePlayerPlugin: Plugin {
  private let coordinator = PlaybackCoordinator.shared

  /** @returns 当前原生播放器状态。 */
  @objc public func status(_ invoke: Invoke) throws {
    invoke.resolve(coordinator.status())
  }

  /** @param invoke 含 PlaybackLoadRequest（播放加载请求）的 Tauri 调用。 */
  @objc public func load(_ invoke: Invoke) throws {
    coordinator.load(try invoke.parseArgs(PlaybackLoadRequest.self))
    invoke.resolve()
  }

  /** 恢复当前原生曲目。 */
  @objc public func play(_ invoke: Invoke) throws {
    coordinator.play()
    invoke.resolve()
  }

  /** 暂停当前原生曲目。 */
  @objc public func pause(_ invoke: Invoke) throws {
    coordinator.pause()
    invoke.resolve()
  }

  /** @param invoke 含 PlaybackSeekRequest（播放定位请求）的 Tauri 调用。 */
  @objc public func seek(_ invoke: Invoke) throws {
    coordinator.seek(to: (try invoke.parseArgs(PlaybackSeekRequest.self)).positionMs)
    invoke.resolve()
  }

  /** 停止当前原生曲目。 */
  @objc public func stop(_ invoke: Invoke) throws {
    coordinator.stop()
    invoke.resolve()
  }
}

/** @returns 供 Rust FFI（外部函数接口）注册的插件实例。 */
@_cdecl("init_plugin_rime_player")
func initPluginRimePlayer() -> Plugin {
  return RimePlayerPlugin()
}
