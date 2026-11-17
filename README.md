# SingDeck

A modern, responsive web dashboard for sing-box, powered by the native Service API.

SingDeck is an independent React application for trusted local or remote sing-box instances. It uses the **native gRPC-Web Service API**, with no Clash REST dependency or extra backend. Baseline: stable **sing-box 1.14.0+ with API version 4**. Other API revisions require verification before use.

## What works

- **Overview:** service/core/API status, uptime, measured upload/download rates, totals, active connections, memory and a live traffic chart.
- **Proxies:** visible groups, protocol/search filters, list/compact card layouts, latency-test requests and selector changes confirmed by server subscription. Automatic groups stay read only.
- **Connections:** live native event reduction, search/network filters, traffic/newest sort, details, paginated desktop table/mobile cards, individual closure and confirmed close-all.
- **Logs:** real-time level/search filters, pause/resume, autoscroll, local clear, copy/export, bounded memory and stream-interruption states.
- **Settings:** endpoint, memory-only Bearer token, real connection test, light/dark/system themes, retry and chart preferences.
- **Explicit mock mode:** streaming traffic/logs/connections plus controllable outages and mutation failures. Native failures never silently become mock data.

A single real instance is active at a time. The storage model supports a profile array; full profile management, localization, PWA, network-quality/STUN and native Clash Mode UI are planned in [the roadmap](docs/roadmap.md).

## Screenshots

Screenshot slots: desktop overview, mobile overview, dark theme, proxies and logs. These should show the explicit Mock mode badge or use sanitized non-private test instances. Local implementation screenshots were reviewed at desktop and mobile sizes; no real credentials or private connection captures are committed.

## Stack

Bun · React 19 · strict TypeScript 6 · Vite 8 · Tailwind CSS 4 · shadcn/ui + Radix · ConnectRPC 2 / Protobuf ES 2 · Recharts · Lucide · Vitest · Playwright · ESLint.

The latest compatible stable versions at initialization are locked in `bun.lock`. TypeScript 7 is currently rejected by typescript-eslint, hence TypeScript 6. Streaming state belongs to a dedicated external session store; unnecessary router/query/state/motion dependencies are intentionally omitted. Hash routing supports `/dashboard/` and static subdirectories.

## Install and develop

Install Bun 1.4.4 and Node 24+, then:

```sh
bun install
bun run dev
```

Open the Vite URL. Configure a trusted API in Settings, or click **Explore demo**. Demo mode is always labeled. Tokens are never persisted: enter them again after reload. Geist font files are bundled; no external font or analytics requests are made.

```sh
bun run lint
bun run typecheck
bun run test
bunx playwright install chromium
bun run test:e2e
bun run build
bun run preview
bun run proto:generate
```

Optional real-service tests require an official binary and a built `dist/`; see [development](docs/development.md). A skipped integration suite is not proof of real API compatibility. CI installs dependencies, regenerates protocol types, lints, type-checks, runs unit/browser tests, builds and checks the official 1.14.0 fixture.

## Deploy

**Built-in:** copy `dist/` contents into the sing-box API service's `dashboard.path`, then open `/dashboard/`. The API endpoint is the listener origin, without `/dashboard/`.

**Independent:** upload `dist/` to a static HTTPS host and set your trusted HTTPS API endpoint in Settings. Configure exact server CORS origins and validate browser network policy. Remote HTTP is refused; loopback HTTP through an SSH tunnel is supported. Never expose an unauthenticated management endpoint.

The [validated example configuration](examples/sing-box-1.14.0.json) binds only to loopback and contains a secret placeholder that **must** be replaced outside the repository. It uses direct outbounds for testing. Follow [deployment instructions](docs/deployment.md) for both paths, security and troubleshooting.

## Architecture and API compatibility

Pinned official Protobuf → generated descriptors → native/mock `SingBoxClient` → cancelable `InstanceSession` → workspace hook/provider → lazy feature pages. Separate stream status keeps partial failures visible. Client-side limits: 300 chart points, 2,000 logs, 16K characters/message, 10,000 active connections and 50 rendered connection rows per page.

Read [architecture](docs/architecture.md), [verified API semantics](docs/api-compatibility.md), [test evidence and limits](docs/verification.md), [contributing](CONTRIBUTING.md) and [agent instructions](AGENTS.md).

## License

AGPL-3.0-or-later; the repository's original [AGPLv3 license](LICENSE) is retained. The unmodified pinned protocol and generated derivatives retain upstream GPL-3.0-or-later notices; see [third-party notices](THIRD_PARTY_NOTICES.md) and [upstream license](proto/LICENSE.sing-box). No official dashboard component/page/style code is reused. Distribute corresponding source and notices with the dashboard.
