use serde::{Deserialize, Serialize};

/**
 * 交给原生播放器加载的、已由服务器授权的播放源。
 *
 * `source_url` 是短期播放会话 URL，而不是长期登录令牌。这样 Android 前台服务和
 * iOS 后台音频无需读取 WebView 的 localStorage（本地存储）即可持续播放。
 */
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadRequest {
    pub source_url: String,
    pub content_type: Option<String>,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: u64,
    pub start_position_ms: u64,
}

/** 原生内核向网页层报告的最小播放快照。 */
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePlaybackStatus {
    pub available: bool,
    pub state: String,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub error: Option<String>,
}

/** 定位命令的参数。 */
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeekRequest {
    pub position_ms: u64,
}

/**
 * 前端同步给 Windows SMTC（系统媒体传输控件）或 macOS Now Playing（正在播放）的状态。
 *
 * 桌面端继续由 HTMLAudioElement（网页音频元素）实际解码，因此此结构只承载系统界面
 * 所需的数据，绝不包含播放 URL 或登录凭证。
 */
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopMediaUpdate {
    /// 曲目切换或清空媒体面板时提供；普通进度同步不重复发送元数据。
    pub metadata: Option<DesktopMediaMetadata>,
    /// 与前端 PlayerStatus（播放器状态）对应的稳定字符串。
    pub state: String,
    /// 当前播放位置，单位毫秒。
    pub position_ms: u64,
    /// 曲目时长，单位毫秒；未知时为零。
    pub duration_ms: u64,
}

/**
 * 桌面系统媒体面板展示的曲目元数据。
 *
 * `artwork_data_url` 使用 data URL（数据 URL）跨越 WebView 的认证边界；Rust 侧会把它
 * 写入应用缓存并以本地 file URL（文件 URL）交给 Windows 和 macOS，避免系统进程无法
 * 读取受鉴权保护的 blob URL（对象 URL）。
 */
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopMediaMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork_data_url: Option<String>,
    pub duration_ms: u64,
}
