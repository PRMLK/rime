# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Rime 的 Android 播放器通过 Tauri 反射调用 @TauriPlugin（插件入口）和 @Command（命令），
# 并由 Jackson 根据 JSON 字段名填充 @InvokeArg（调用参数）。发布版 R8 若压缩这组成员，
# load（播放加载）会失败并触发网页音频回退，系统因此看不到 MediaSession（媒体会话）。
# 这条应用级规则确保即使 Tauri 的本地插件依赖没有传递 consumer rules，最终 APK 仍保留
# 原生播放器所需的类名、方法名和请求字段名。
-keep class com.prmlk.rime.player.** { *; }
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault
