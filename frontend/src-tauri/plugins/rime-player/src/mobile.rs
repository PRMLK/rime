use serde::{de::DeserializeOwned, Serialize};
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::{
    models::{DesktopMediaUpdate, LoadRequest, NativePlaybackStatus, SeekRequest},
    Error, Result,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.prmlk.rime.player";
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_rime_player);

/**
 * 初始化当前移动平台的 Kotlin 或 Swift 插件。
 *
 * @param _app - Tauri 应用句柄；移动插件由 PluginApi（插件 API）负责注册。
 * @param api - Tauri 提供的平台插件注册接口。
 * @returns 供 Rust 命令层调用的播放器句柄。
 */
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<RimePlayer<R>> {
    #[cfg(target_os = "android")]
    let handle = api
        .register_android_plugin(PLUGIN_IDENTIFIER, "RimePlayerPlugin")
        // `?` 不会自动串联 PluginInvokeError -> tauri::Error -> Error。
        .map_err(tauri::Error::from)?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_rime_player)?;
    Ok(RimePlayer(handle))
}

/** 移动端原生播放器的 Rust 侧命令门面。 */
pub struct RimePlayer<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> RimePlayer<R> {
    /**
     * 调用移动端原生插件，并统一转换跨平台边界产生的错误。
     *
     * Tauri 的移动插件 API 返回 `PluginInvokeError`，而本插件对外暴露
     * `Error`。两者之间需要先经过 Tauri 的标准错误类型；显式完成这两步
     * 转换可避免各播放命令重复处理，并符合 Rust `?` 只执行一次转换的规则。
     *
     * @param command - Kotlin 或 Swift 插件中注册的命令名称。
     * @param payload - 可序列化的命令参数；无参数命令使用 `()`。
     * @returns 成功时反序列化后的原生响应，失败时返回插件统一错误类型。
     */
    fn invoke<T: DeserializeOwned>(&self, command: &str, payload: impl Serialize) -> Result<T> {
        self.0
            .run_mobile_plugin(command, payload)
            .map_err(tauri::Error::from)
            .map_err(Error::from)
    }

    /**
     * 读取原生播放服务的当前快照。
     *
     * @returns 包含服务可用性、状态和播放位置的快照。
     */
    pub fn status(&self) -> Result<NativePlaybackStatus> {
        self.invoke("status", ())
    }

    /**
     * 替换当前播放源并立即开始播放。
     *
     * @param request - 已解析的播放 URL 与系统媒体界面所需元数据。
     * @returns 无返回值；原生服务会自行维护后台播放和通知。
     */
    pub fn load(&self, request: LoadRequest) -> Result<()> {
        self.invoke("load", request)
    }

    /** 恢复当前媒体。 */
    pub fn play(&self) -> Result<()> {
        self.invoke("play", ())
    }

    /** 暂停当前媒体。 */
    pub fn pause(&self) -> Result<()> {
        self.invoke("pause", ())
    }

    /**
     * 跳转到指定位置。
     *
     * @param request - 以毫秒表示的目标位置。
     * @returns 无返回值。
     */
    pub fn seek(&self, request: SeekRequest) -> Result<()> {
        self.invoke("seek", request)
    }

    /** 停止并释放当前原生播放项。 */
    pub fn stop(&self) -> Result<()> {
        self.invoke("stop", ())
    }

    /**
     * 移动端由 Media3 或 AVFoundation 直接维护系统媒体会话，不能再注册桌面桥接层。
     *
     * @returns 始终返回 false，使前端保留移动端原生播放服务的唯一所有权。
     */
    pub fn desktop_media_controls_available(&self) -> bool {
        false
    }

    /**
     * 拒绝桌面媒体面板同步请求。
     *
     * @param _update - 仅供跨平台命令签名一致性使用的桌面媒体状态。
     * @returns 始终返回 Unavailable（当前平台不可用），调用方会安静忽略该路径。
     */
    pub fn update_desktop_media_controls(&self, _update: DesktopMediaUpdate) -> Result<()> {
        Err(Error::Unavailable)
    }
}
