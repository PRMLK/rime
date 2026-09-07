use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::{models::{LoadRequest, NativePlaybackStatus, SeekRequest}, Error, Result};

/**
 * 初始化桌面端门面。
 *
 * Windows 与 macOS 当前继续使用 WebView 的音频解码和 Media Session（媒体会话）
 * 集成。返回不可用状态能让前端显式回退，避免同一首歌被网页与原生内核重复播放。
 */
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> Result<RimePlayer<R>> {
    Ok(RimePlayer(std::marker::PhantomData))
}

/** 桌面端原生播放的占位门面。 */
pub struct RimePlayer<R: Runtime>(std::marker::PhantomData<R>);

impl<R: Runtime> RimePlayer<R> {
    /** @returns 明确表示桌面端应使用网页播放器的不可用快照。 */
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
}
