# Mobile packaging and CI/CD

Rime uses Tauri 2 for its installable mobile client. Both development and release
builds bundle the local Vite `/mobile.html` entry. The native client asks the user
to select a Rime server, validates its API capabilities, and then connects with a
Bearer session. The browser client keeps using its current same-origin cookie flow.

## GitHub Actions release flow

The `Mobile release` workflow supports two modes:

- A manual run builds signed per-ABI Android APK files and one universal AAB, then stores them as workflow artifacts.
- Pushing a tag such as `v0.1.2` also creates a GitHub Release and attaches all packages.
- Google Play internal testing is optional and runs only when `PUBLISH_GOOGLE_PLAY` is `true`.

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
下载表。目前仅填写已有的 Android APK，其他平台单元格保留为空：

| Architecture | Windows | Ubuntu | Mac | Android | Flatpak | iOS | Web |
| --- | --- | --- | --- | --- | --- | --- | --- |
| x86-64 (64-bit) |  |  |  | `app-x86_64-release.apk` |  |  |  |
| AArch64 (ARM64) |  |  |  | `app-arm64-release.apk` |  |  |  |
| ARMv7 (32-bit) |  |  |  | `app-arm-release.apk` |  |  |  |
| x86-32 (32-bit) |  |  |  | `app-x86-release.apk` |  |  |  |

AAB 仍会作为 Google Play 分发附件上传。以后发布其他平台时，只填写
`.github/workflows/mobile-release.yml` 中对应的空单元格即可。

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
