const COMMANDS: &[&str] = &[
    "status",
    "load",
    "play",
    "pause",
    "seek",
    "stop",
    "desktop_media_controls_available",
    "update_desktop_media_controls",
];

/**
 * 将本地 Android Library 与 iOS Swift Package 注册为 Tauri 插件工件。
 *
 * 该构建脚本只描述平台目录和可调用命令；实际播放器逻辑分别留在 Kotlin 与 Swift，
 * 因而移动端在 WebView 被系统暂停后仍能由原生播放服务继续执行。
 */
fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
