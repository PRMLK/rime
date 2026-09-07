use tauri::{command, AppHandle, Runtime};

use crate::{
    models::{DesktopMediaUpdate, LoadRequest, NativePlaybackStatus, SeekRequest},
    Result, RimePlayerExt,
};

/** @returns 当前平台原生播放器的状态快照。 */
#[command]
pub(crate) async fn status<R: Runtime>(app: AppHandle<R>) -> Result<NativePlaybackStatus> {
    app.rime_player().status()
}

/** @param request 要加载的媒体源和元数据。 */
#[command]
pub(crate) async fn load<R: Runtime>(app: AppHandle<R>, request: LoadRequest) -> Result<()> {
    app.rime_player().load(request)
}

/** 恢复当前原生媒体。 */
#[command]
pub(crate) async fn play<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.rime_player().play()
}

/** 暂停当前原生媒体。 */
#[command]
pub(crate) async fn pause<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.rime_player().pause()
}

/** @param request 以毫秒表示的目标位置。 */
#[command]
pub(crate) async fn seek<R: Runtime>(app: AppHandle<R>, request: SeekRequest) -> Result<()> {
    app.rime_player().seek(request)
}

/** 停止并释放当前原生媒体。 */
#[command]
pub(crate) async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.rime_player().stop()
}

/**
 * 初始化桌面系统媒体面板并报告是否可用。
 *
 * Windows 需要主窗口已经创建，故不能在插件 setup（初始化）阶段提前断言可用；由前端
 * 首次加载播放器后触发，若系统拒绝注册则安全回退到 Web Media Session（媒体会话）。
 *
 * @returns Windows/macOS 成功注册系统媒体面板时为 true，其他平台或失败时为 false。
 */
#[command]
pub(crate) async fn desktop_media_controls_available<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    Ok(app.rime_player().desktop_media_controls_available())
}

/**
 * 将网页音频播放器的快照同步给桌面操作系统。
 *
 * @param update 当前曲目元数据（可选）、播放状态和进度。
 * @returns 成功时无返回值；系统媒体接口失败时返回可序列化错误。
 */
#[command]
pub(crate) async fn update_desktop_media_controls<R: Runtime>(
    app: AppHandle<R>,
    update: DesktopMediaUpdate,
) -> Result<()> {
    app.rime_player().update_desktop_media_controls(update)
}
