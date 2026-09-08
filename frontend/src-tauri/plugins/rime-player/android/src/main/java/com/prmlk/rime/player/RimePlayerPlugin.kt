package com.prmlk.rime.player

import android.app.Activity
import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaController
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionToken
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.common.util.concurrent.ListenableFuture

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
 * 将 Tauri 请求转换为 Media3 能通过 MediaController（媒体控制器）发送给服务的媒体项。
 *
 * @returns 包含播放地址和系统媒体界面元数据的单曲 MediaItem（媒体项）。
 */
private fun PlaybackLoadRequest.toMediaItem(): MediaItem = MediaItem.Builder()
    // Rime 当前每次只让原生服务维护一个播放项，固定 ID 不会暴露含临时签名的播放 URL。
    .setMediaId("rime-current-track")
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

/**
 * 连接 PlaybackService（播放服务）的唯一 MediaController（媒体控制器）。
 *
 * Media3 的标准模式是先通过 SessionToken（会话令牌）连接服务，再由控制器改变播放器状态。
 * 这会让 MediaSessionService（媒体会话服务）在服务创建时登记会话，并由 Media3 自动创建
 * MediaStyle（媒体样式）通知和媒体前台服务。不能用自定义 Intent（意图）直接驱动服务，
 * 因为 MediaSessionService 只处理标准媒体动作。
 */
private object PlaybackControllerBridge {
    private var controllerFuture: ListenableFuture<MediaController>? = null

    /**
     * 取得已连接的媒体控制器，必要时异步启动并连接播放服务。
     *
     * @param context Android 上下文；仅使用 applicationContext（应用上下文），避免持有 Activity。
     * @param onConnected 控制器连接成功后在主线程执行的播放命令。
     * @param onFailure 连接失败时在主线程执行的错误处理。
     * @returns 无返回值；结果通过回调交给 Tauri 命令异步 resolve（成功）或 reject（失败）。
     */
    fun withController(
        context: Context,
        onConnected: (MediaController) -> Unit,
        onFailure: (Exception) -> Unit,
    ) {
        val applicationContext = context.applicationContext
        val future = synchronized(this) {
            controllerFuture ?: MediaController.Builder(
                applicationContext,
                SessionToken(applicationContext, ComponentName(applicationContext, PlaybackService::class.java)),
            ).buildAsync().also { controllerFuture = it }
        }
        future.addListener({
            try {
                onConnected(future.get())
            } catch (error: Exception) {
                // 连接失败的 future（未来结果）不能复用，否则所有后续播放都会立即失败。
                synchronized(this) {
                    if (controllerFuture === future) controllerFuture = null
                }
                onFailure(error)
            }
        }, ContextCompat.getMainExecutor(applicationContext))
    }
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
        /** Android 13 及以上向用户请求媒体通知权限时使用的稳定请求编号。 */
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
        runPlayerCommand(invoke) { controller ->
            controller.setMediaItem(request.toMediaItem(), request.startPositionMs.coerceAtLeast(0))
            controller.prepare()
            controller.play()
        }
    }

    /**
     * 在用户主动开始播放时请求 Android 媒体通知权限。
     *
     * Android 13（API 33）起，POST_NOTIFICATIONS（通知权限）属于运行时权限；仅在
     * AndroidManifest.xml（Android 清单）中声明不能让媒体卡片出现在小米控制中心。请求
     * 必须放在用户点击播放的操作内，既符合 Android 的权限时机要求，也避免应用启动时
     * 的无上下文弹窗。低版本、已授权和不支持运行时权限的设备会直接跳过。
     *
     * @returns 无返回值；授权结果由 Android 系统异步处理，MediaSessionService（媒体会话
     * 服务）创建的媒体通知会在用户允许后由系统正常展示。
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
        runPlayerCommand(invoke) { controller -> controller.play() }
    }

    /** 暂停已加载的曲目。 */
    @Command
    fun pause(invoke: Invoke) {
        runPlayerCommand(invoke) { controller -> controller.pause() }
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
        runPlayerCommand(invoke) { controller -> controller.seekTo(request.positionMs.coerceAtLeast(0)) }
    }

    /** 停止播放并清空服务中的播放项。 */
    @Command
    fun stop(invoke: Invoke) {
        runPlayerCommand(invoke) { controller ->
            controller.stop()
            controller.clearMediaItems()
        }
    }

    /**
     * 在控制器准备好后执行一个播放器命令，并将连接或命令异常回传给 WebView。
     *
     * @param invoke Tauri 调用上下文；异步连接完成后才 resolve（成功）或 reject（失败）。
     * @param command 需要在已连接 MediaController（媒体控制器）上执行的命令。
     * @returns 无返回值。
     */
    private fun runPlayerCommand(invoke: Invoke, command: (MediaController) -> Unit) {
        PlaybackControllerBridge.withController(
            activity,
            onConnected = { controller ->
                try {
                    command(controller)
                    invoke.resolve()
                } catch (error: Exception) {
                    invoke.reject(error.message ?: "原生媒体控制命令执行失败")
                }
            },
            onFailure = { error ->
                invoke.reject(error.message ?: "无法连接 Android 原生播放服务")
            },
        )
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
        @Volatile
        private var activeService: PlaybackService? = null

        /**
         * 读取当前服务状态，供同一 Android 插件模块中的 Tauri 命令使用。
         *
         * @returns 服务存在时返回其播放快照；服务不存在时标记为原生能力可用但尚未播放。
         */
        internal fun currentStatus(): PlaybackStatus = activeService?.snapshot()
            ?: PlaybackStatus(true, "idle", 0, 0)
    }
}
