# Rime Music 交接说明

更新日期：2026-09-02

## 1. 项目定位

Rime Music 是一个面向 Web、Windows、macOS 与 Android 的音乐播放器客户端原型。当前仓库已完成 Web 前端雏形与独立移动端页面，重点是为后续播放器功能提供可响应式验证的开发画布。

当前阶段不是可上线的流媒体服务：没有用户体系、音乐目录、音频流、下载、播放引擎、后端 API 或原生壳层。

## 2. 技术选型

### 已采用

| 层级 | 选型 | 作用 |
| --- | --- | --- |
| Web UI | React 19 + TypeScript | 组件化界面与交互状态 |
| 构建与本地开发 | Vite 7 | 快速开发服务与静态站点构建 |
| 样式 | Tailwind CSS 4 | 响应式布局与语义主题令牌 |
| 组件基础 | shadcn/ui（Base UI） | Button、Input、Separator、Tooltip 等基础组件 |
| 图标 | Lucide React | 播放控制与底部导航图标 |
| 字体 | Geist Variable | 当前界面的默认无衬线字体 |

### 跨端客户端建议

建议在当前 React/Vite 前端稳定后接入 **Tauri 2 + Rust** 作为 Windows、macOS 与 Android 的原生壳层。

* Tauri 不需要搭配 Go。Go 只在未来确实需要独立媒体服务、P2P、复杂下载器等单独进程时再评估。
* Vite 是当前前端构建工具；Tauri 通过其 `devUrl` 和 `frontendDist` 配置加载 Vite 的开发服务与构建产物。
* Web 端保留 React/Vite 入口；Windows、macOS 与 Android 共用页面层与业务状态，按平台通过 Tauri 命令、插件或前端适配层接入能力。
* 真实音频播放建议抽象为 `PlayerService`：Web 可接入 `<audio>`/Media Session，Android 可接入 Media3，桌面端按 Tauri 插件或 Rust 原生实现接入。不要把播放逻辑直接散落在页面组件中。

### 构建平台说明

UI 代码可以共用，但原生产物通常不能在一台机器上可靠地一次性完成所有签名与发布：

| 目标 | 推荐构建环境 | 备注 |
| --- | --- | --- |
| Web | 任意支持 Node.js 的 CI 或本机 | 输出静态 `dist/` 文件 |
| Windows | Windows CI/构建机 | 负责 Windows 安装包与签名 |
| macOS | macOS CI/构建机 | 负责 macOS 签名、公证与安装包 |
| Android | macOS、Linux 或 Windows + Android SDK | 生成 APK/AAB；发布到 Play 商店使用 AAB |

建议使用 CI 构建矩阵分别产出各平台包，而不是将“一个命令生成所有端”作为发布策略。

## 3. 当前实现

### 页面结构

```text
frontend/index.html
  -> frontend/src/main.tsx
    -> Viewbox（开发套件）
      -> iframe /mobile.html
        -> frontend/src/mobile.tsx
          -> MobilePlayer（独立移动端页面）
```

`Viewbox` 只是外层开发工具，不参与移动端页面布局或状态渲染。它默认加载 `/mobile.html`，可切换 20:9 竖屏手机比例与 4:3 横屏平板比例，也可隐藏整个预览区。

### 已完成功能

* 浅色、低干扰的 Viewbox 开发画布；控制按钮独立定位，不影响预览内容。
* 独立 `mobile.html` 移动端入口，使用 iframe 与 Viewbox 隔离。
* 简洁的流媒体播放器首页：当前播放封面、曲名、艺术家、进度与待播列表。
* 固定双层底栏：上层为封面、曲目信息、上一首、播放/暂停、下一首；下层为首页、搜索、我的三栏导航。
* 搜索、收藏、播放/暂停、导航切换等本地 UI 状态与可访问标签。
* 本地封面资源：`src/assets/now-playing.jpg`。
* Vite 多页面构建：构建产物同时包含 `index.html` 与 `mobile.html`。

### 关键文件

| 文件 | 职责 |
| --- | --- |
| `frontend/src/main.tsx` | 保持干净，仅挂载 Viewbox |
| `frontend/src/components/Viewbox.tsx` | 开发套件、开关与设备比例切换 |
| `frontend/src/components/Viewbox.css` | 外层浅色画布与 Viewbox 尺寸规则 |
| `frontend/mobile.html` | 独立移动端 HTML 入口 |
| `frontend/src/mobile.tsx` | 挂载移动端 React 页面 |
| `frontend/src/components/MobilePlayer.tsx` | 播放器主页面、底栏与局部状态 |
| `frontend/src/index.css` | Tailwind、shadcn 主题令牌与全局样式 |
| `frontend/vite.config.ts` | Vite 与 Tailwind 配置；声明双 HTML 入口 |

### 当前限制与后续优先级

1. 用于展示的歌曲、搜索结果、播放进度与个人库都是前端静态数据。
2. 播放/暂停只切换 UI 状态，不会播放音频。
3. 未接入路由、状态持久化、接口请求、鉴权、错误处理、离线缓存或下载管理。
4. 继续实现时优先建立领域模型与 `PlayerService` 接口，再接入真实播放器和数据源。
5. 引入 Tauri 前，先让 Web 端的播放状态、队列、搜索和个人库流程具备测试覆盖。

## 4. 本地开发

前置条件：安装与 Vite 7 兼容的 Node.js 运行时及 npm。

```bash
cd frontend
npm ci
npm run dev
```

默认访问地址：`http://127.0.0.1:5173/`

* `/`：Viewbox 开发套件入口。
* `/mobile.html`：绕过 Viewbox，直接查看独立移动端页面。

生产构建：

```bash
cd frontend
npm run build
```

该命令会先运行 TypeScript 构建检查，再生成 `dist/` 静态目录。当前已验证构建通过。

本地查看生产构建：

```bash
cd frontend
npm run preview
```

## 5. Web 部署

### 静态托管

此项目可直接部署到 Vercel、Netlify、Cloudflare Pages、GitHub Pages（需要配置子路径）或任意 Nginx 静态站点。

通用配置：

| 配置项 | 值 |
| --- | --- |
| 安装命令 | `npm ci` |
| 构建命令 | `npm run build` |
| 发布目录 | `dist` |

必须将 `dist/index.html`、`dist/mobile.html` 与 `dist/assets/` 一并上传并保持目录结构，因 Viewbox 运行时会加载移动端入口和静态资源。

### Nginx 示例

将 `dist/` 内容放入 `/var/www/rime` 后，可使用：

```nginx
server {
    listen 80;
    server_name music.example.com;

    root /var/www/rime;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

当前没有前端历史路由，因此不需要将所有未知路径重写到 `index.html`。部署时应确认 `/mobile.html` 可直接返回该 HTML 文件。

### 子路径部署注意事项

当前 Viewbox 的默认预览地址是根路径 `/mobile.html`。因此现状适合部署在域名根目录，例如 `https://music.example.com/`。

若部署在子路径（例如 `https://example.com/rime/`），构建前需要将 `VITE_VIEWBOX_SRC` 设置为该子路径下的移动端入口，例如：

```bash
VITE_VIEWBOX_SRC=/rime/mobile.html npm run build
```

同时需要为 Vite 配置匹配的 `base`，并确认静态托管平台将 `mobile.html` 与 `assets/` 发布到该子路径。完成这一调整后再部署，避免 iframe 请求根路径导致 404。

## 6. Tauri 接入与原生发布（后续）

开始原生客户端开发时，建议采用以下顺序：

1. 安装 Rust、平台原生构建工具与 Android SDK；Android 开发可在 macOS 上使用 Android Studio 模拟器。
2. 在本项目中初始化 Tauri 2，配置开发地址为 Vite 服务、生产前端目录为 `dist`。
3. 保持 `mobile.html`/`MobilePlayer` 的页面层不依赖 Viewbox；原生壳加载正式用户入口，Viewbox 仅保留给开发环境。
4. 通过平台适配层实现播放、媒体会话、通知、文件缓存、SQLite 和权限处理。
5. 在 CI 中分别构建 Web、Windows、macOS 与 Android，并分别配置签名、证书与商店发布流程。

Tauri 的初始化、Android 构建与签名尚未在本仓库执行，因此不能将当前代码直接视为 Windows、macOS 或 Android 安装包项目。
