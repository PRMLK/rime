/** Rime 原生播放器插件的统一错误类型。 */
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Tauri 的命令或移动插件调用失败。
    #[error(transparent)]
    Tauri(#[from] tauri::Error),

    /// 当前运行时没有可用的原生播放内核，例如桌面端使用网页 Media Session 时。
    #[error("native playback is unavailable on this platform")]
    Unavailable,
}

/** 插件内部使用的结果别名。 */
pub type Result<T> = std::result::Result<T, Error>;
