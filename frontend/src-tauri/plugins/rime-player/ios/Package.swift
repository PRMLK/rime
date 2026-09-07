// swift-tools-version:5.3
import PackageDescription

/**
 * Tauri 在初始化 iOS 工程时会把该静态包链接进应用。
 * 播放实现仅依赖系统 AVFoundation（音视频基础框架）与 MediaPlayer（媒体控制框架）。
 */
let package = Package(
  name: "tauri-plugin-rime-player",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v15),
  ],
  products: [
    .library(
      name: "tauri-plugin-rime-player",
      type: .static,
      targets: ["tauri-plugin-rime-player"]),
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api"),
  ],
  targets: [
    .target(
      name: "tauri-plugin-rime-player",
      dependencies: [.byName(name: "Tauri")],
      path: "Sources"),
  ]
)
