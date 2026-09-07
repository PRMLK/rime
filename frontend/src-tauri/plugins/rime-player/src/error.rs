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

impl serde::Serialize for Error {
    /**
     * 将插件内部错误转换为 Tauri IPC（进程间通信）可传输的字符串。
     *
     * `tauri::Error` 并不保证可直接序列化，因此不能为整个枚举派生
     * `Serialize`。命令层只需要向前端传达错误信息，统一序列化为
     * `Display` 文本可以保留根因说明，同时满足 Tauri 命令的返回契约。
     *
     * @param serializer - Serde 提供的输出序列化器。
     * @returns 包含当前错误文本的序列化结果；底层写入失败时返回序列化错误。
     */
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/** 插件内部使用的结果别名。 */
pub type Result<T> = std::result::Result<T, Error>;
