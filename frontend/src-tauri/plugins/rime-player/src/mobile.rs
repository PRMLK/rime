use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::{models::{LoadRequest, NativePlaybackStatus, SeekRequest}, Result};

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
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "RimePlayerPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_rime_player)?;
    Ok(RimePlayer(handle))
}

/** 移动端原生播放器的 Rust 侧命令门面。 */
pub struct RimePlayer<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> RimePlayer<R> {
    /**
     * 读取原生播放服务的当前快照。
     *
     * @returns 包含服务可用性、状态和播放位置的快照。
     */
    pub fn status(&self) -> Result<NativePlaybackStatus> {
        self.0.run_mobile_plugin("status", ()).map_err(Into::into)
    }

    /**
     * 替换当前播放源并立即开始播放。
     *
     * @param request - 已解析的播放 URL 与系统媒体界面所需元数据。
     * @returns 无返回值；原生服务会自行维护后台播放和通知。
     */
    pub fn load(&self, request: LoadRequest) -> Result<()> {
        self.0.run_mobile_plugin("load", request).map_err(Into::into)
    }

    /** 恢复当前媒体。 */
    pub fn play(&self) -> Result<()> {
        self.0.run_mobile_plugin("play", ()).map_err(Into::into)
    }

    /** 暂停当前媒体。 */
    pub fn pause(&self) -> Result<()> {
        self.0.run_mobile_plugin("pause", ()).map_err(Into::into)
    }

    /**
     * 跳转到指定位置。
     *
     * @param request - 以毫秒表示的目标位置。
     * @returns 无返回值。
     */
    pub fn seek(&self, request: SeekRequest) -> Result<()> {
        self.0.run_mobile_plugin("seek", request).map_err(Into::into)
    }

    /** 停止并释放当前原生播放项。 */
    pub fn stop(&self) -> Result<()> {
        self.0.run_mobile_plugin("stop", ()).map_err(Into::into)
    }
}
