# 客户端打包与 CI/CD（持续集成与持续部署）

Rime 使用 Tauri 2 构建可安装客户端。Android、Windows x86-64 与 macOS ARM64
发布包都会打入本地 Vite 的 `/mobile.html` 入口。原生客户端会要求用户选择 Rime
服务器、校验 API（应用程序接口）能力后以 Bearer 会话连接；浏览器客户端继续使用
同源 Cookie 流程。

## GitHub Actions release flow

`Client release`（客户端发布）工作流支持两种模式：

- 手动运行会构建已签名的 Android 分 ABI APK 和通用 AAB，以及 Windows x86-64 的 EXE/MSI 与 macOS ARM64 的 DMG；所有产物都会保存为工作流附件。
- 推送如 `v0.1.2` 的标签还会创建 GitHub Release（GitHub 发布版本），并上传所有平台的安装包。
- Google Play 内部测试为可选项，仅在 `PUBLISH_GOOGLE_PLAY` 为 `true` 时执行。

Set the optional `PUBLISH_GOOGLE_PLAY` repository Actions variable to `true` only
after Google Play is ready. No server URL is compiled into the mobile package.

Configure these Actions secrets for Android signing:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded upload keystore file |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Upload key alias, commonly `upload` |
| `ANDROID_KEY_PASSWORD` | Upload key password |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Google Play service account JSON; only required for Play publishing |

Create the Android upload key once and keep it outside the repository:

```bash
keytool -genkey -v -keystore upload-keystore.jks -storetype JKS \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
base64 -i upload-keystore.jks | pbcopy
```

Paste the copied value into `ANDROID_KEYSTORE_BASE64`. Losing this key prevents
future updates from using the same signing identity, so keep a separate secure backup.

Before the first automated Google Play upload, create the application with package
ID `com.prmlk.rime` in Play Console and upload one signed AAB manually. Then grant
the service account access to the app and enable `PUBLISH_GOOGLE_PLAY`.

## Creating a release

Keep the version in `frontend/src-tauri/tauri.conf.json` aligned with the tag:

```bash
git tag v0.1.2
git push origin v0.1.2
```

The workflow rejects a tag that does not match the Tauri version. The direct-download
APKs are split into `arm64`, `armv7`, `x86`, and `x86_64` packages so each contains
only the native library required by that device. The universal AAB is uploaded to
Google Play, which handles device-specific delivery automatically.

每个标签发布都会在自动生成的变更日志前展示与 RustDesk 相同的“架构 × 平台”
下载表。Windows x86-64 同时提供 EXE 与 MSI，macOS ARM64 提供 DMG，未构建的平台
单元格保留为空：

| Architecture | Windows | Linux | Mac | Android | Flatpak | iOS | Web |
| --- | --- | --- | --- | --- | --- | --- | --- |
| x86-64 (64-bit) | `rime-windows-x86_64.exe`、`rime-windows-x86_64.msi` |  |  | `rime-x86_64-release.apk` |  |  |  |
| AArch64 (ARM64) |  |  | `rime-macos-aarch64.dmg` | `rime-arm64-release.apk` |  |  |  |
| ARMv7 (32-bit) |  |  |  | `rime-arm-release.apk` |  |  |  |
| x86-32 (32-bit) |  |  |  | `rime-x86-release.apk` |  |  |  |

AAB 仍会作为 Google Play 分发附件上传。以后发布 Linux 或其他平台时，只填写
`.github/workflows/mobile-release.yml` 中对应的空单元格即可。

## 本地桌面端构建

在对应操作系统的 `frontend/` 目录安装依赖后执行：

```bash
# Windows x86-64：生成 NSIS EXE 与 MSI
npm run tauri:windows:release

# Apple Silicon macOS：生成 ARM64 DMG
npm run tauri:macos:release
```

## Local Android build

Install Rust, JDK 17, Android SDK, and Android NDK, then expose `JAVA_HOME`,
`ANDROID_HOME`, and `NDK_HOME`. Useful commands from `frontend/` are:

```bash
npm ci
npm run tauri:android:dev
npm run tauri:android:debug
npm run tauri:android:release
```

For a locally signed release, create
`frontend/src-tauri/gen/android/keystore.properties` using the standard Android
`storeFile`, `storePassword`, `keyAlias`, and `keyPassword` keys. This file is ignored by Git.

## iOS status

The Tauri configuration and npm commands are ready, but App Store automation is
not enabled yet. It requires a fixed Apple Development Team ID, an Apple Developer
certificate and provisioning profile, an App Store Connect API key, and a complete
Xcode installation. On a configured macOS machine, initialize and build with:

```bash
npm run tauri:ios:init
npm run tauri:ios:release
```

Once those Apple identifiers and credentials exist, the same tag workflow can add
a macOS runner that signs the IPA and uploads it to TestFlight/App Store Connect.
