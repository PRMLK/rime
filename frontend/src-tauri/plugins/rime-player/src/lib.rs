//! Rime 的原生后台音频插件。
//!
//! Android 与 iOS 使用各自的系统播放器；Windows 与 macOS 保持网页音频解码，
//! 但通过原生系统媒体面板暴露曲目信息和媒体键。这样移动端的播放生命周期不再依赖
//! 可能被系统冻结的 WebView，桌面端也不会因更换音频内核而破坏现有缓存链路。

use tauri::{plugin::{Builder, TauriPlugin}, Manager, Runtime};

mod commands;
#[cfg(desktop)]
mod desktop;
mod error;
#[cfg(mobile)]
mod mobile;
mod models;

pub use error::{Error, Result};
#[cfg(desktop)]
pub use desktop::RimePlayer;
#[cfg(mobile)]
pub use mobile::RimePlayer;

/** 为所有 Tauri manager（管理器）提供播放器访问器。 */
pub trait RimePlayerExt<R: Runtime> {
    /** @returns 已在应用启动阶段注册的原生播放器门面。 */
    fn rime_player(&self) -> &RimePlayer<R>;
}

impl<R: Runtime, T: Manager<R>> RimePlayerExt<R> for T {
    fn rime_player(&self) -> &RimePlayer<R> {
        self.state::<RimePlayer<R>>().inner()
    }
}

/**
 * 初始化插件并注册前端可调用命令。
 *
 * @returns 可挂载到 `tauri::Builder` 的插件实例。
 */
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("rime-player")
        .invoke_handler(tauri::generate_handler![
            commands::status,
            commands::load,
            commands::play,
            commands::pause,
            commands::seek,
            commands::stop,
            commands::desktop_media_controls_available,
            commands::update_desktop_media_controls,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let player = mobile::init(app, api)?;
            #[cfg(desktop)]
            let player = desktop::init(app, api)?;
            app.manage(player);
            Ok(())
        })
        .build()
}
