use serde::{de::DeserializeOwned, Serialize};
use std::marker::PhantomData;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::{
    models::{DesktopMediaMetadata, DesktopMediaUpdate, LoadRequest, NativePlaybackStatus, SeekRequest},
    Error, Result,
};

#[cfg(any(target_os = "windows", target_os = "macos"))]
use {
    base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _},
    souvlaki::{
        MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition,
        PlatformConfig,
    },
    std::{fs, sync::Mutex, time::Duration},
    tauri::{Emitter, Manager},
};

#[cfg(target_os = "windows")]
use {
    raw_window_handle::{HasWindowHandle, RawWindowHandle},
    std::ffi::c_void,
};

/** 前端监听原生 Windows/macOS 媒体键时使用的 Tauri 事件名称。 */
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub const DESKTOP_MEDIA_COMMAND_EVENT: &str = "rime-player://desktop-media-command";

/**
 * 初始化桌面端播放器门面。
 *
 * 实际音频继续由 WebView 的 HTMLAudioElement（网页音频元素）解码。系统媒体控制器
 * 延迟到前端第一次询问时才创建，因为 Windows 的 SMTC（系统媒体传输控件）要求主
 * WebviewWindow（网页视图窗口）已存在。
 *
 * @param app - Tauri 应用句柄，用于获取窗口句柄、缓存目录并向前端发回媒体键事件。
 * @param _api - 桌面端无平台插件实现，保留参数以满足 Tauri 插件初始化签名。
 * @returns 可供命令层访问的桌面播放器门面。
 */
pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> Result<RimePlayer<R>> {
    Ok(RimePlayer {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        app: app.clone(),
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        media_controls: Mutex::new(None),
        runtime: PhantomData,
    })
}

/**
 * 桌面端的播放器门面。
 *
 * `media_controls`（系统媒体控制器）只表示 Windows/macOS 的 UI 桥接能力，绝不表示
 * 原生音频解码可用。因此 `status`（状态查询）始终返回 unavailable，前端会继续选择
 * HTMLAudioElement，避免同一首歌被两套内核重复播放。
 */
pub struct RimePlayer<R: Runtime> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    app: AppHandle<R>,
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    media_controls: Mutex<Option<MediaControls>>,
    runtime: PhantomData<R>,
}

impl<R: Runtime> RimePlayer<R> {
    /** @returns 明确表示桌面端应使用网页音频播放器的不可用快照。 */
    pub fn status(&self) -> Result<NativePlaybackStatus> {
        Ok(NativePlaybackStatus {
            available: false,
            state: "idle".into(),
            position_ms: 0,
            duration_ms: 0,
            error: None,
        })
    }

    /** @returns 桌面端不接受原生加载请求，调用方会回退到 HTMLAudioElement。 */
    pub fn load(&self, _request: LoadRequest) -> Result<()> { Err(Error::Unavailable) }
    /** @returns 桌面端不接受原生播放请求。 */
    pub fn play(&self) -> Result<()> { Err(Error::Unavailable) }
    /** @returns 桌面端不接受原生暂停请求。 */
    pub fn pause(&self) -> Result<()> { Err(Error::Unavailable) }
    /** @returns 桌面端不接受原生定位请求。 */
    pub fn seek(&self, _request: SeekRequest) -> Result<()> { Err(Error::Unavailable) }
    /** @returns 桌面端不接受原生停止请求。 */
    pub fn stop(&self) -> Result<()> { Err(Error::Unavailable) }

    /**
     * 尝试注册 Windows SMTC（系统媒体传输控件）或 macOS Now Playing（正在播放）。
     *
     * @returns 系统媒体面板可用时为 true；Linux、窗口尚未创建或系统接口初始化失败时
     * 返回 false，前端会继续使用浏览器的 Media Session（媒体会话）。
     */
    pub fn desktop_media_controls_available(&self) -> bool {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        {
            return self.ensure_desktop_media_controls();
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            false
        }
    }

    /**
     * 同步网页音频的状态到 Windows/macOS 原生媒体面板。
     *
     * @param update 当前曲目（可选）、状态和进度；只在切歌时包含元数据以避免重复加载封面。
     * @returns 同步成功时无返回值；媒体面板未初始化或系统拒绝更新时返回错误。
     */
    pub fn update_desktop_media_controls(&self, update: DesktopMediaUpdate) -> Result<()> {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        {
            if !self.ensure_desktop_media_controls() {
                return Err(Error::Unavailable);
            }
            let mut controls = self
                .media_controls
                .lock()
                .map_err(|_| Error::DesktopMediaControls("media controls lock is poisoned".into()))?;
            let controls = controls.as_mut().ok_or(Error::Unavailable)?;
            if let Some(metadata) = update.metadata.as_ref() {
                let cover_url = self.write_artwork(metadata);
                controls
                    .set_metadata(MediaMetadata {
                        title: metadata.title.as_deref(),
                        artist: metadata.artist.as_deref(),
                        album: metadata.album.as_deref(),
                        cover_url: cover_url.as_deref(),
                        duration: duration_from_ms(metadata.duration_ms),
                    })
                    .map_err(|error| Error::DesktopMediaControls(error.to_string()))?;
            }
            controls
                .set_playback(playback_from_update(&update))
                .map_err(|error| Error::DesktopMediaControls(error.to_string()))?;
            return Ok(());
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            let _ = update;
            Err(Error::Unavailable)
        }
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    /**
     * 延迟创建系统媒体控制器并安装命令转发回调。
     *
     * `MediaControls`（系统媒体控制器）在 Windows 上绑定创建时的 HWND（窗口句柄），在
     * macOS 上绑定应用主事件循环。创建失败不应影响网页音频，故该函数仅返回布尔值。
     *
     * @returns 控制器已存在或本次创建成功时为 true，否则为 false。
     */
    fn ensure_desktop_media_controls(&self) -> bool {
        let mut current = match self.media_controls.lock() {
            Ok(current) => current,
            Err(_) => return false,
        };
        if current.is_some() {
            return true;
        }

        let config = match platform_config(&self.app) {
            Some(config) => config,
            None => return false,
        };
        let mut controls = match MediaControls::new(config) {
            Ok(controls) => controls,
            Err(_) => return false,
        };
        let app = self.app.clone();
        if controls
            .attach(move |event| {
                if let Some(command) = desktop_media_command(event) {
                    // 系统媒体回调不在 WebView 线程执行；Tauri 事件会安全地投递回前端。
                    let _ = app.emit(DESKTOP_MEDIA_COMMAND_EVENT, command);
                }
            })
            .is_err()
        {
            return false;
        }
        *current = Some(controls);
        true
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    /**
     * 将 WebView 已获授权的封面 data URL（数据 URL）缓存为本地文件。
     *
     * Windows 的 SMTC（系统媒体传输控件）和 macOS 的 NSImage（原生图片）均可稳定读取
     * file URL（文件 URL），却不能读取只存在于 WebView 进程的 blob URL（对象 URL）。
     * 文件名固定为当前封面并通过临时文件原子替换，避免系统在写入中读取半张图片。
     *
     * @param metadata 当前曲目的桌面媒体元数据。
     * @returns 可交给系统媒体接口的 file URL；数据无效、过大或写入失败时返回 None。
     */
    fn write_artwork(&self, metadata: &DesktopMediaMetadata) -> Option<String> {
        let data_url = metadata.artwork_data_url.as_deref()?;
        let (header, encoded) = data_url.split_once(',')?;
        if !header.starts_with("data:image/") || !header.ends_with(";base64") {
            return None;
        }
        // 只接受 5 MiB 以下的封面，防止错误响应或恶意数据占满应用缓存。
        if encoded.len() > 7 * 1024 * 1024 {
            return None;
        }
        let bytes = BASE64_STANDARD.decode(encoded).ok()?;
        if bytes.len() > 5 * 1024 * 1024 {
            return None;
        }
        let extension = if header.starts_with("data:image/png") {
            "png"
        } else if header.starts_with("data:image/webp") {
            "webp"
        } else {
            "jpg"
        };
        let directory = self.app.path().app_cache_dir().ok()?.join("now-playing");
        fs::create_dir_all(&directory).ok()?;
        let artwork_path = directory.join(format!("cover.{extension}"));
        let temporary_path = directory.join(format!("cover.{extension}.part"));
        fs::write(&temporary_path, bytes).ok()?;
        fs::rename(&temporary_path, &artwork_path).ok()?;
        file_url(&artwork_path)
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
/**
 * 构建当前平台要求的系统媒体控制器配置。
 *
 * @param app - 用于查找主 WebviewWindow（网页视图窗口）的 Tauri 应用句柄。
 * @returns Windows/macOS 所需配置；Windows 主窗口或原生句柄不可用时返回 None。
 */
fn platform_config<R: Runtime>(app: &AppHandle<R>) -> Option<PlatformConfig<'static>> {
    #[cfg(target_os = "windows")]
    let hwnd = {
        let window = app.get_webview_window("main")?;
        let handle = window.window_handle().ok()?;
        let RawWindowHandle::Win32(handle) = handle.as_raw() else {
            return None;
        };
        Some(handle.hwnd.get() as *mut c_void)
    };
    #[cfg(target_os = "macos")]
    let hwnd = None;

    Some(PlatformConfig {
        display_name: "Rime",
        dbus_name: "com.prmlk.rime",
        hwnd,
    })
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
/**
 * 将系统媒体键转换为前端播放器可理解的 JSON（JavaScript 对象表示法）命令。
 *
 * @param event souvlaki（系统媒体控制库）从 Windows 或 macOS 回调的原始事件。
 * @returns 能安全转发的命令；无绝对位置的模糊定位请求返回 None，避免猜测跳转幅度。
 */
fn desktop_media_command(event: MediaControlEvent) -> Option<DesktopMediaCommand> {
    match event {
        MediaControlEvent::Play => Some(DesktopMediaCommand::simple("play")),
        MediaControlEvent::Pause | MediaControlEvent::Stop => Some(DesktopMediaCommand::simple("pause")),
        MediaControlEvent::Toggle => Some(DesktopMediaCommand::simple("toggle")),
        MediaControlEvent::Next => Some(DesktopMediaCommand::simple("next")),
        MediaControlEvent::Previous => Some(DesktopMediaCommand::simple("previous")),
        MediaControlEvent::SetPosition(position) => Some(DesktopMediaCommand {
            command_type: "seek",
            position_ms: Some(duration_to_ms(position.0)),
        }),
        // Seek 和 SeekBy 均未提供可以无歧义套用到网页播放器的绝对播放位置。
        MediaControlEvent::Seek(_) | MediaControlEvent::SeekBy(_, _) | MediaControlEvent::SetVolume(_)
        | MediaControlEvent::OpenUri(_) | MediaControlEvent::Raise | MediaControlEvent::Quit => None,
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
/** 原生媒体键事件通过 Tauri 事件总线发送给前端的最小负载。 */
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMediaCommand {
    #[serde(rename = "type")]
    command_type: &'static str,
    position_ms: Option<u64>,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl DesktopMediaCommand {
    /** @returns 不含进度参数的系统媒体命令。 */
    fn simple(command_type: &'static str) -> Self {
        Self {
            command_type,
            position_ms: None,
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
/** @returns 毫秒转换成系统媒体库使用的 Duration（时长）。 */
fn duration_from_ms(milliseconds: u64) -> Option<Duration> {
    (milliseconds > 0).then(|| Duration::from_millis(milliseconds))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
/** @returns Duration（时长）转换后的毫秒；超出 u64 时钳制到最大值。 */
fn duration_to_ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
/**
 * 将网页播放器状态转换成操作系统的媒体播放状态。
 *
 * @param update 网页音频播放器的最新快照。
 * @returns 可交给 Windows SMTC 或 macOS Now Playing 的播放状态与可选进度。
 */
fn playback_from_update(update: &DesktopMediaUpdate) -> MediaPlayback {
    let progress = duration_from_ms(update.duration_ms).map(|duration| {
        MediaPosition(Duration::from_millis(update.position_ms.min(duration_to_ms(duration))))
    });
    match update.state.as_str() {
        "playing" => MediaPlayback::Playing { progress },
        "paused" | "loading" | "error" => MediaPlayback::Paused { progress },
        _ => MediaPlayback::Stopped,
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
/**
 * 生成系统媒体接口可读取的 file URL（文件 URL）。
 *
 * @param path 应用缓存目录内、已完成原子写入的封面文件路径。
 * @returns 对文件路径中的空格和非 ASCII（非 ASCII 字符）完成编码后的 file URL。
 */
fn file_url(path: &std::path::Path) -> Option<String> {
    let path = path.canonicalize().ok()?;
    let path = path.to_string_lossy().replace('\\', "/");
    let encoded = percent_encode_file_path(&path);
    #[cfg(target_os = "windows")]
    return Some(format!("file:///{encoded}"));
    #[cfg(target_os = "macos")]
    return Some(format!("file://{encoded}"));
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
/**
 * 对 file URL（文件 URL）路径中不能直接出现的字节进行百分号编码。
 *
 * @param path 规范化后的本地文件路径；Windows 路径已统一使用正斜杠。
 * @returns 保留路径分隔符和 Windows 驱动器冒号的安全 URL 路径。
 */
fn percent_encode_file_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.' | b'~' | b':') {
            encoded.push(byte as char);
        } else {
            use std::fmt::Write as _;
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}
