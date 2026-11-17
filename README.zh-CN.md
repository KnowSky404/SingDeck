# SingDeck

[English](README.md)

面向 sing-box 原生 Service API 的独立 Web 面板，支持稳定版 **sing-box ≥1.14.0、API 4**。浏览器直连你的实例，无额外后端或 Clash REST 依赖。

## 本地使用（推荐）

sing-box 可以自动下载发布包并在本地启动面板。把下面的 `dashboard` 配置合并到已有 `services` → `type: api` 中：

```json
"dashboard": {
  "enabled": true,
  "path": "./singdeck-dashboard",
  "download_url": "https://github.com/KnowSky404/SingDeck/releases/latest/download/singdeck.zip",
  "update_interval": "24h"
}
```

使用新的空目录，重启 sing-box。下载完成后打开 `http://127.0.0.1:<API端口>/dashboard/`，输入 API 密钥连接。无需使用在线面板。相对路径取决于核心工作目录，可改为绝对路径；运行核心的用户须有写入权限。

[完整自动下载配置](examples/sing-box-dashboard-download.json) · [本地与远程部署指南](docs/deployment.md)

若要固定 v0.3.0，下载地址使用：

```text
https://github.com/KnowSky404/SingDeck/releases/download/v0.3.0/singdeck-v0.3.0.zip
```

也可以从 [Releases](https://github.com/KnowSky404/SingDeck/releases/latest) 下载 ZIP 和 `SHA256SUMS`，核对校验值后解压到 `dashboard.path`，确保目录直接包含 `index.html` 和 `assets/`。GitHub 的 Source code 压缩包不是编译后的面板。手动放入的面板目录不会启用核心自动更新，改用自动下载时请使用新的空目录。

## 界面

- 单实例入口：配置地址和密钥后进入；右上角连接图标显示当前服务并提供退出、重试。切换服务先退出，暂不提供多实例管理。
- 右上角图标切换中英文及浅色、深色、跟随系统主题。偏好保存在浏览器中。
- 概览：实时流量、内存、运行时间、实例状态和最近日志。页面说明移到菜单悬停／键盘焦点提示，正文优先展示数据。
- 代理：代理组和节点分别切换列表／卡片布局，支持组折叠、搜索、协议筛选、延迟测试和实例确认的节点选择。
- 连接：默认显示活动连接，可筛选已关闭记录；支持状态、网络、出站、搜索组合筛选，详情、分页和关闭操作。API 未提供独立 Blocked 状态，不会推测阻止结果。
- 日志：默认 INFO 及以上（包含 WARN、ERROR 等），可手动查看 DEBUG、TRACE。支持 ANSI 颜色、搜索、暂停、复制和导出。显示筛选不修改核心日志配置。
- 设置：仅保留实例／版本信息和下载、部署链接。

[在线体验](https://knowsky404.github.io/SingDeck/) 可选择演示模式，演示不会访问你的服务。真实连接失败也不会自动切换为演示。

## 安全与限制

密钥只保存在内存中，退出连接或刷新后需重新输入。不要把私人配置、密钥加入仓库、URL 或前端构建变量。API 建议绑定回环地址；远程连接需要可信 HTTPS，或通过 SSH 隧道。跨域部署须配置准确 CORS 来源及浏览器网络权限。

界面最多保留 2,000 条日志和 10,000 条连接记录；优先淘汰已关闭历史，连接每页展示 50 条。关闭历史来自实例报告，核心可能只保留部分历史，重新连接会按服务端快照重置。

开发使用 Bun 1.4.4、Node 24+，执行 `bun install --frozen-lockfile` 和 `bun run dev`。所有改动遵循 [worktree、review、PR 流程](CONTRIBUTING.md)。验证命令和真实核心测试见[开发文档](docs/development.md)。

AGPL-3.0-or-later。分发时保留对应源码和许可证；上游协议保留其 GPL 声明，详见 [LICENSE](LICENSE) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。
