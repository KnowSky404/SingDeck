# Static deployment

Build once with `bun install --frozen-lockfile` and `bun run build`. Deploy **the contents of `dist/`**. No backend, environment-injected secrets or RPC forwarding is needed. Vite uses relative asset URLs; navigation uses hashes, so both `/dashboard/#/logs` and an arbitrary static subdirectory survive refresh without an HTML fallback rule.

## A. sing-box built-in dashboard

The included [1.14.0 example](../examples/sing-box-1.14.0.json) was validated using the actual release binary, including `sing-box check`. It listens on loopback only, configures an explicit secret placeholder and serves `./dist` at `/dashboard/`.

1. Copy the example outside version control. Replace `REPLACE_WITH_A_LONG_RANDOM_SECRET` with a strong unique secret. Restrict the configuration file's read permissions. Never add the private config to this repository.
2. Set `dashboard.path` to the absolute directory containing the built `index.html` and `assets/`. Alternatively keep `./dist` and launch sing-box from the project root.
3. Run `sing-box check -c /path/to/private-config.json`, then `sing-box run -c /path/to/private-config.json`.
4. Open `http://127.0.0.1:19090/dashboard/`. The entry form infers `http://127.0.0.1:19090`; enter the secret, test the connection, then Connect. To change the service later, use the top-right connection icon → Disconnect and return to the entry form.

For a VPS, retain loopback bindings and use an SSH tunnel from your own computer:

```sh
ssh -N -L 19090:127.0.0.1:19090 user@your-vps
```

Then open the same local dashboard URL. The dashboard uses the browser-visible endpoint, not the VPS's private address. Use a dedicated HTTPS listener/reverse proxy or a trusted Tailscale path for persistent remote access. Remote plain HTTP is rejected by SingDeck. Do not disable certificate checks.

A populated custom dashboard directory is served as-is by sing-box and prevents upstream auto-download. Do not copy an upstream `.etag` file into the directory. The sample's outbounds are direct connections for reproducible integration, not a production proxy configuration; add your real outbounds privately.

## A2. Automatic release download and local hosting / 自动下载后本地启动

The official [native API dashboard options](https://sing-box.sagernet.org/configuration/service/api/#dashboard) support downloading a ZIP, extracting it into `dashboard.path` and serving it from the API listener. This is local hosting, with no dependency on visiting GitHub Pages.

将下面对象合并到你已有配置的 `services` → `type: api` 中，保留现有的出站、规则和 API 密钥。完整可检查示例见 [sing-box-dashboard-download.json](../examples/sing-box-dashboard-download.json)。

```json
{
  "type": "api",
  "tag": "api",
  "listen": "127.0.0.1",
  "listen_port": 9090,
  "secret": "REPLACE_WITH_A_LONG_RANDOM_SECRET",
  "dashboard": {
    "enabled": true,
    "path": "./singdeck-dashboard",
    "download_url": "https://github.com/KnowSky404/SingDeck/releases/latest/download/singdeck.zip",
    "update_interval": "24h"
  }
}
```

- `dashboard.path` 最初应不存在或为空，且运行 sing-box 的用户有写入权限。相对路径基于 sing-box 的工作目录，建议按自己的系统改成绝对路径。
- 重启 sing-box 后会异步下载；下载完成再打开 `http://127.0.0.1:9090/dashboard/`，入口会识别 API 地址。填写相同的 `secret` 即可连接，刷新后需重新输入密钥。
- `latest/download/singdeck.zip` 跟随最新稳定版本；`update_interval` 控制后台更新检查。首发下载需能访问 GitHub 及其发布资产域名，失败会在核心日志中显示。
- 如需固定本版，将 URL 改为 `https://github.com/KnowSky404/SingDeck/releases/download/v0.6.0/singdeck-v0.6.0.zip`。固定 URL 不会自动跳到后续版本。
- 已手动放入文件且没有 sing-box 管理标记的目录，会被当作用户提供的面板，自动更新不会启用。切换到自动下载时使用新的空目录，保留旧目录作备份；不要删除私人配置，也不要手工伪造 `.etag`。
- 如果下载需要经代理，可按官方 [HTTP client options](https://sing-box.sagernet.org/configuration/shared/http-client/) 配置 `dashboard.http_client`；不要把代理或 API 密钥放到下载 URL 中。

For offline/manual installation, download the versioned ZIP and `SHA256SUMS` from the same release, verify the archive hash, and extract its **contents** into `dashboard.path`. The ZIP root contains `index.html`, `assets/` and license notices. GitHub's automatically generated source archives are source code, not `dist`. All release ZIP names point to the same tested build. Manual files are served as-is rather than auto-updated.

A local official-binary fixture tests ZIP download/extraction and `/dashboard/` assets. Public GitHub reachability, a user's proxy route and browser permissions still depend on their environment.

## B. independent static hosting

Upload `dist/` to any static HTTPS host, including a subdirectory. Configure the real HTTPS API endpoint and Bearer token in the browser. No runtime environment file is needed. Do not embed tokens in a Vite variable: all Vite client variables are public.

On the sing-box API service, set `access_control_allow_origin` to the exact dashboard origin (scheme, hostname, port; no path/trailing slash), e.g. `https://dashboard.example.org`. The native server handles OPTIONS/POST and the required gRPC-Web authentication/status headers. Preserve the full `/daemon.StartedService/<Method>` path if routing via a prefix.

For HTTPS reverse proxies, forward binary POST bodies, authorization and gRPC status headers, disable response buffering for server streams, and allow long streaming responses. Terminate TLS with a browser-trusted certificate; never create a publicly accessible unauthenticated relay. Prefer same-origin deployment to minimize browser policy issues. Use a restrictive CSP suited to your host, including `connect-src` only for explicitly trusted API origins; do not permit arbitrary third-party scripts on a management dashboard.

## GitHub Pages preview

The repository publishes to [https://knowsky404.github.io/SingDeck/](https://knowsky404.github.io/SingDeck/). Click **Explore demo** for the clearly labeled simulated workspace. The public site contains only frontend assets; no private API credentials or backend relay are deployed.

`.github/workflows/pages.yml` runs when a release is published, or when explicitly dispatched. It calls the full reusable CI workflow, then deploys the exact verified `dist/` artifact to Pages after all checks pass. Stable releases update Pages; prereleases only receive their tested archive. The workflow also attaches `singdeck-<tag>.zip`, the stable filename `singdeck.zip`, and `SHA256SUMS` to each release. The stable filename supports `/releases/latest/download/singdeck.zip` for core-managed updates. A published tag must match `package.json` and point to a commit already merged into `main`. Branch/PR CI continues to run independently; pushes to `main` do not publish Pages before a release. Repository Settings → Pages must use **GitHub Actions** as the source. The `github-pages` environment must allow release tags (`v*`) as well as the main branch; otherwise a valid tagged release is rejected before deployment. Relative assets and hash routes work under `/SingDeck/` without changing the built-in `/dashboard/` deployment.

For a real connection from this preview, use your own trusted HTTPS API and allow the exact CORS origin `https://knowsky404.github.io` (without `/SingDeck/`). Plain HTTP APIs may be blocked by mixed-content policy; private-network endpoints also depend on browser permissions. Tokens remain in browser memory.

## Old dashboard after switching or updating / 切换或更新后仍显示旧面板

First try **Ctrl + Shift + R** in Firefox on Windows/Linux. In a confirmed migration case, the core was already serving SingDeck while the browser still showed the previous dashboard; a force reload resolved it. This is different from the core failing to download the new files.

先按 **Ctrl + Shift + R** 强制刷新。已确认的迁移案例中，服务端已经返回 SingDeck，浏览器仍显示旧面板，强制刷新后恢复；这种情况无需重新下载面板或修改入口配置。

If force reload does not help, compare a private window and the server response. A remaining Service Worker from a previous dashboard may also need unregistering. See the bilingual Wiki: [English troubleshooting](https://github.com/KnowSky404/SingDeck/wiki/Troubleshooting#old-dashboard-after-switching-or-updating) / [中文排查步骤](https://github.com/KnowSky404/SingDeck/wiki/Troubleshooting-zh-CN#切换或更新后仍显示旧面板). Avoid clearing unrelated sites or deleting the dashboard/configuration directory to fix browser caches.

## Diagnosing access failures

| Symptom | Check |
| --- | --- |
| Authentication failed | Secret must match Bearer token; no query auth, cookies or URL credentials |
| Connection interrupted | Listener address, trusted TLS chain, exact CORS origin and browser network console |
| HTTPS dashboard → HTTP API | Mixed content; use HTTPS or same-origin/tunnel deployment |
| Browser local/private network denial | Browser permission, secure context and optional `access_control_allow_private_network`; CORS alone cannot override browser policy |
| Connected, missing groups | The instance may have no visible group outbounds |
| Missing traffic/connections | Tracking capability unavailable; UI marks it explicitly |
| Graph stops behind reverse proxy | Disable buffering and increase streaming timeout |
| Reload loses token | Expected: credentials are memory only; re-enter them |
| API version unsupported | Only API 4 and stable core ≥1.14.0 are accepted; verify new versions before upgrading the gate |

Local HTTP SDK/browser tests prove baseline transport, CORS, streaming and built-in hosting. They do **not** establish external VPS TLS/PNA correctness. Verify those policies in your target browser and network before using remote management. See [verification](verification.md).

## Source and licenses

Distribute the corresponding SingDeck source and retain `LICENSE`, `proto/LICENSE.sing-box`, `THIRD_PARTY_NOTICES.md` and bundled license notices when redistributing the dashboard. Public hosting does not remove applicable source obligations. The footer links to the upstream source repository; downstream deployments must offer their actual corresponding modified source and update that link. The static build also includes AGPL and upstream GPL license texts. Build artifacts contain no access credentials.
