package com.prmlk.rime.player

import android.app.Activity
import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * 前端传给原生播放器的播放源和系统媒体元数据。
 *
 * 所有字段均采用 camelCase（小驼峰）以匹配 Rust 和 TypeScript 的序列化约定。播放
 * URL 是后端签发的短期会话地址，因此服务无需从 WebView 读取长期登录凭证。
 */
@InvokeArg
class PlaybackLoadRequest {
    lateinit var sourceUrl: String
    var contentType: String? = null
    lateinit var title: String
    lateinit var artist: String
    lateinit var album: String
    var durationMs: Long = 0
    var startPositionMs: Long = 0
}

/** 用于定位命令的参数对象，单位为毫秒。 */
@InvokeArg
class PlaybackSeekRequest {
    var positionMs: Long = 0
}

/**
 * 可序列化为 Tauri JSObject（JavaScript 对象）的原生播放状态。
 *
 * 前端使用此快照在回到前台后恢复进度显示；通知栏本身由 MediaSessionService（媒体
 * 会话服务）直接从 ExoPlayer 状态更新，不依赖 WebView 是否仍在运行。
 */
// 播放状态只在 Android 插件模块内流转，不应成为服务对外暴露的公共类型。
internal data class PlaybackStatus(
    val available: Boolean,
    val state: String,
    val positionMs: Long,
    val durationMs: Long,
    val error: String? = null,
) {
    /** @returns 可直接由 Tauri 命令返回给 JavaScript 的状态对象。 */
    fun toJson(): JSObject = JSObject().also { result ->
        result.put("available", available)
        result.put("state", state)
        result.put("positionMs", positionMs)
        result.put("durationMs", durationMs)
        if (error != null) result.put("error", error)
    }
}

/**
 * Tauri 2 的 Android 原生插件入口。
 *
 * 命令仅把短小的控制意图发送给 PlaybackService（播放服务）；耗时的网络读取和音频
 * 解码完全由 Media3 在服务中执行，避免阻塞 Android 主线程或依赖 WebView 生命周期。
 */
@TauriPlugin
class RimePlayerPlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        /** Android 13 及以上向用户请求媒体通知权限时使用的请求编号。 */
        private const val MEDIA_NOTIFICATION_PERMISSION_REQUEST_CODE = 4101
    }

    /** @returns 原生服务当前快照；服务尚未启动时返回 idle（空闲）。 */
    @Command
    fun status(invoke: Invoke) {
        invoke.resolve(PlaybackService.currentStatus().toJson())
    }

    /**
     * 加载一首歌并启动媒体前台服务。
     *
     * @param invoke Tauri 的调用上下文，包含 PlaybackLoadRequest（播放加载请求）。
     * @returns 无返回值；服务一创建即设置曲目并调用 play，系统随后展示媒体通知。
     */
    @Command
    fun load(invoke: Invoke) {
        val request = invoke.parseArgs(PlaybackLoadRequest::class.java)
        requestNotificationPermissionForMediaControls()
        PlaybackService.load(activity, request)
        invoke.resolve()
    }

    /**
     * 在用户主动开始播放时请求通知权限，保证前台媒体通知可展示给澎湃 OS 的控制中心。
     *
     * Android 13（API 33）起，`POST_NOTIFICATIONS`（通知权限）是运行时权限。仅在
     * AndroidManifest.xml（Android 清单）中声明并不会自动授权；小米澎湃 OS 还会限制
     * 后台本地通知，因此必须在用户触发播放这一明确场景中请求。Media3（Android 媒体
     * 框架）仍会继续维护 MediaSession（媒体会话），用户允许后系统立即能显示其通知。
     *
     * @returns 无返回值。低于 Android 13、已授权或系统不支持请求的设备会直接跳过。
     */
    private fun requestNotificationPermissionForMediaControls() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return
        }
        activity.requestPermissions(
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            MEDIA_NOTIFICATION_PERMISSION_REQUEST_CODE,
        )
    }

    /** 恢复已加载的曲目。 */
    @Command
    fun play(invoke: Invoke) {
        PlaybackService.sendCommand(activity, PlaybackService.ACTION_PLAY)
        invoke.resolve()
    }

    /** 暂停已加载的曲目。 */
    @Command
    fun pause(invoke: Invoke) {
        PlaybackService.sendCommand(activity, PlaybackService.ACTION_PAUSE)
        invoke.resolve()
    }

    /**
     * 定位当前曲目。
     *
     * @param invoke Tauri 调用上下文，包含毫秒级目标位置。
     * @returns 无返回值；播放器会将位置夹在有效范围内。
     */
    @Command
    fun seek(invoke: Invoke) {
        val request = invoke.parseArgs(PlaybackSeekRequest::class.java)
        PlaybackService.seek(activity, request.positionMs)
        invoke.resolve()
    }

    /** 停止播放并清空服务中的播放项。 */
    @Command
    fun stop(invoke: Invoke) {
        PlaybackService.sendCommand(activity, PlaybackService.ACTION_STOP)
        invoke.resolve()
    }
}

/**
 * Android 后台播放服务。
 *
 * ExoPlayer（Android 播放器）与 MediaSession（系统媒体会话）均归此服务持有。只要
 * 实际播放仍在进行，Media3 会提升为媒体类型前台服务并维护通知栏，因而小米、一加等
 * 系统不会把它当成普通的后台 WebView 进程回收。
 */
class PlaybackService : MediaSessionService() {
    private var player: ExoPlayer? = null
    private var mediaSession: MediaSession? = null
    private var playbackError: String? = null

    /**
     * 创建播放器和系统媒体会话。
     *
     * @returns 无返回值；音频焦点由 `handleAudioFocus = true` 自动管理，其他音频
     * 播放时本播放器会按 Android 系统策略暂停或降低音量。
     */
    override fun onCreate() {
        super.onCreate()
        activeService = this
        val attributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()
        // 网络流媒体在熄屏后可能被 Wi-Fi 省电策略中断。WAKE_MODE_NETWORK（网络唤醒模式）
        // 会在播放器处于播放或缓冲、且 playWhenReady 为 true 时自动管理 CPU/Wi-Fi 锁；
        // 暂停、停止和释放播放器时锁会自动归还，避免手写锁遗漏释放造成耗电。
        player = ExoPlayer.Builder(this)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
            .also { exoPlayer ->
                exoPlayer.setAudioAttributes(attributes, true)
                exoPlayer.addListener(object : Player.Listener {
                    /** 播放、暂停与焦点切换后更新供前端查询的快照。 */
                    override fun onIsPlayingChanged(isPlaying: Boolean) {
                        playbackError = null
                    }

                    /** 缓冲、结束或就绪状态由 status（状态）命令按需读取。 */
                    override fun onPlaybackStateChanged(playbackState: Int) = Unit

                    /** 保存最近一次错误，方便页面恢复到前台后展示原因。 */
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        playbackError = error.message ?: "原生音频播放失败"
                    }
                })
            }
        mediaSession = MediaSession.Builder(this, requireNotNull(player)).build()
    }

    /**
     * 处理来自 Tauri 插件的播放控制 Intent（意图）。
     *
     * @param intent 含曲目元数据或控制动作的服务启动 Intent。
     * @param flags Android 服务重启策略；无活动播放时不主动重启，避免无用户行为的后台启动。
     * @param startId 本次服务启动序号。
     * @returns START_NOT_STICKY（不粘性启动）；父类会处理系统媒体按键和前台通知的
     * 生命周期，但应用不盲目重启已经停止的播放。
     */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // MediaSessionService（媒体会话服务）会在父类中处理系统发来的媒体按键 Intent。
        // 不能跳过该调用，否则蓝牙耳机、锁屏和小米控制中心的系统控制命令可能失效。
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_LOAD -> loadItem(intent)
            ACTION_PLAY -> player?.play()
            ACTION_PAUSE -> player?.pause()
            ACTION_SEEK -> player?.seekTo(intent.getLongExtra(EXTRA_POSITION_MS, 0).coerceAtLeast(0))
            ACTION_STOP -> stopPlayback()
        }
        return START_NOT_STICKY
    }

    /**
     * 暴露唯一系统媒体会话给通知栏、锁屏、蓝牙耳机和 Android Auto 等控制器。
     *
     * @param controllerInfo 请求连接的系统控制器信息。
     * @returns 当前应用唯一的媒体会话。
     */
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    /**
     * 释放播放器和媒体会话。
     *
     * @returns 无返回值；先 release（释放）会让 Media3 正确撤销前台通知与音频焦点。
     */
    override fun onDestroy() {
        activeService = null
        mediaSession?.release()
        mediaSession = null
        player?.release()
        player = null
        super.onDestroy()
    }

    /**
     * MediaSessionService 负责绑定，不向普通客户端提供 Binder（绑定器）。
     *
     * @param intent 绑定请求。
     * @returns null。
     */
    override fun onBind(intent: Intent?): IBinder? = super.onBind(intent)

    /**
     * 将加载请求转为带系统元数据的 MediaItem（媒体项）。
     *
     * @param intent 包含前端已经验证过的播放 URL 与曲目字段。
     * @returns 无返回值；同一服务只保留一个活动播放项，切歌时会原子替换。
     */
    private fun loadItem(intent: Intent) {
        val sourceUrl = intent.getStringExtra(EXTRA_SOURCE_URL) ?: return
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "未知歌曲"
        val artist = intent.getStringExtra(EXTRA_ARTIST) ?: "未知艺人"
        val album = intent.getStringExtra(EXTRA_ALBUM) ?: "未知专辑"
        val contentType = intent.getStringExtra(EXTRA_CONTENT_TYPE)
        val startPosition = intent.getLongExtra(EXTRA_POSITION_MS, 0).coerceAtLeast(0)
        val item = MediaItem.Builder()
            .setUri(sourceUrl)
            .setMimeType(contentType)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(artist)
                    .setAlbumTitle(album)
                    .build(),
            )
            .build()
        playbackError = null
        player?.apply {
            setMediaItem(item, startPosition)
            prepare()
            play()
        }
    }

    /** 清空媒体、取消前台播放资格并停止无用服务。 */
    private fun stopPlayback() {
        player?.apply {
            stop()
            clearMediaItems()
        }
        stopSelf()
    }

    /** @returns 当前播放器快照，供 WebView 从暂停状态恢复时同步界面。 */
    private fun snapshot(): PlaybackStatus {
        val exoPlayer = player
            ?: return PlaybackStatus(true, "idle", 0, 0, playbackError)
        val state = when (exoPlayer.playbackState) {
            Player.STATE_BUFFERING -> "loading"
            Player.STATE_ENDED -> "ended"
            Player.STATE_IDLE -> "idle"
            Player.STATE_READY -> if (exoPlayer.isPlaying) "playing" else "paused"
            else -> "idle"
        }
        val duration = exoPlayer.duration.takeIf { it != C.TIME_UNSET && it >= 0 } ?: 0
        return PlaybackStatus(true, state, exoPlayer.currentPosition.coerceAtLeast(0), duration, playbackError)
    }

    companion object {
        const val ACTION_LOAD = "com.prmlk.rime.player.LOAD"
        const val ACTION_PLAY = "com.prmlk.rime.player.PLAY"
        const val ACTION_PAUSE = "com.prmlk.rime.player.PAUSE"
        const val ACTION_SEEK = "com.prmlk.rime.player.SEEK"
        const val ACTION_STOP = "com.prmlk.rime.player.STOP"
        private const val EXTRA_SOURCE_URL = "sourceUrl"
        private const val EXTRA_CONTENT_TYPE = "contentType"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_ARTIST = "artist"
        private const val EXTRA_ALBUM = "album"
        private const val EXTRA_POSITION_MS = "positionMs"

        @Volatile
        private var activeService: PlaybackService? = null

        /**
         * 启动或更新前台媒体服务。
         *
         * @param context 当前 Tauri Activity 的上下文。
         * @param request 前端传入的安全播放会话与曲目元数据。
         * @returns 无返回值；服务会在收到 ACTION_LOAD 后立即调用 play。
         */
        fun load(context: Context, request: PlaybackLoadRequest) {
            val intent = Intent(context, PlaybackService::class.java).apply {
                action = ACTION_LOAD
                putExtra(EXTRA_SOURCE_URL, request.sourceUrl)
                putExtra(EXTRA_CONTENT_TYPE, request.contentType)
                putExtra(EXTRA_TITLE, request.title)
                putExtra(EXTRA_ARTIST, request.artist)
                putExtra(EXTRA_ALBUM, request.album)
                putExtra(EXTRA_POSITION_MS, request.startPositionMs)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        /**
         * 向已有服务发送无参数控制命令。
         *
         * @param context 当前 Tauri Activity 的上下文。
         * @param action 播放、暂停或停止动作。
         * @returns 无返回值。
         */
        fun sendCommand(context: Context, action: String) {
            context.startService(Intent(context, PlaybackService::class.java).setAction(action))
        }

        /**
         * 向已有服务发送定位命令。
         *
         * @param context 当前 Tauri Activity 的上下文。
         * @param positionMs 目标位置，单位毫秒。
         * @returns 无返回值。
         */
        fun seek(context: Context, positionMs: Long) {
            context.startService(Intent(context, PlaybackService::class.java).apply {
                action = ACTION_SEEK
                putExtra(EXTRA_POSITION_MS, positionMs.coerceAtLeast(0))
            })
        }

        /**
         * 读取当前服务状态，供同一 Android 插件模块中的 Tauri 命令使用。
         *
         * @returns 服务存在时返回其播放快照；服务不存在时标记为原生能力可用但尚未播放。
         */
        internal fun currentStatus(): PlaybackStatus = activeService?.snapshot()
            ?: PlaybackStatus(true, "idle", 0, 0)
    }
}
