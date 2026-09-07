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
