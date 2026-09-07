use tauri::{command, AppHandle, Runtime};

use crate::{models::{LoadRequest, NativePlaybackStatus, SeekRequest}, Result, RimePlayerExt};

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
