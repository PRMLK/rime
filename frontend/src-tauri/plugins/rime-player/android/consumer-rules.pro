# Tauri 通过反射按类名和 @Command（原生命令）注解调用 Android 插件。发布包启用 R8 后，
# 如果允许重命名或删除这些成员，status（无参数状态查询）可能仍能工作，但 load（播放加载）
# 的 Jackson 参数解析会因 sourceUrl、title 等字段被混淆而失败，前端随后静默回退网页音频。
# 保留这个小型插件包的完整 ABI（应用二进制接口），不影响应用其余代码的压缩效果。
-keep class com.prmlk.rime.player.** { *; }

# @TauriPlugin、@Command 与 @InvokeArg（调用参数）均由运行时读取；R8 默认可删除无直接
# Java 调用点的注解属性，因此显式保留注解元数据，保证发布 APK 与调试 APK 行为一致。
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault
