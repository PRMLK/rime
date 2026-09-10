import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ConfigEnv, type UserConfig } from 'vite';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8080';
const tauriDevHost = process.env.TAURI_DEV_HOST;

/**
 * 根据 Vite（前端构建工具）的模式创建构建配置。
 *
 * 网页端的 `index.html` 是默认移动端页面，`test.html` 则是加载根路径预览的 Viewbox
 * （网页预览壳）。多页模式会在本地开发时把 `/test` 解析为 `test.html`。原生端只会由
 * Tauri（原生应用壳）打开 `mobile.html`，将它单独输出到 `dist-native/`，避免把
 * Viewbox 及其独占依赖带入安装包。
 *
 * @param config - Vite 传入的命令与模式信息；`native` 模式用于 Tauri 打包。
 * @returns 分别面向网页或原生客户端的 Vite 配置。
 */
export function createConfig({ mode }: ConfigEnv): UserConfig {
  const isNativeBuild = mode === 'native';

  return {
    // 多页模式保留独立的编辑器入口，并让开发服务器将 /test 映射到 test.html。
    appType: 'mpa',
    plugins: [react(), tailwindcss()],
    server: {
      host: tauriDevHost || false,
      port: 5173,
      strictPort: true,
      hmr: tauriDevHost
        ? {
            protocol: 'ws',
            host: tauriDevHost,
            port: 1421,
          }
        : undefined,
      proxy: {
        '/api': { target: apiProxyTarget, changeOrigin: false },
        '/healthz': { target: apiProxyTarget, changeOrigin: false },
      },
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
    envPrefix: ['VITE_', 'TAURI_ENV_*'],
    build: {
      // 原生端独立目录可防止一次构建清空另一端的产物，也让 Tauri 只收集移动端资源。
      outDir: isNativeBuild ? 'dist-native' : 'dist',
      target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
      minify: !process.env.TAURI_ENV_DEBUG,
      sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
      rollupOptions: {
        input: isNativeBuild
          ? { mobile: path.resolve(__dirname, 'mobile.html') }
          : {
              main: path.resolve(__dirname, 'index.html'),
              test: path.resolve(__dirname, 'test.html'),
            },
      },
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  };
}

export default defineConfig(createConfig);
