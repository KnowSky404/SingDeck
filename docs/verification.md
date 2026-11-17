# Verification record

Implementation validation: 2026-11-17, Linux x86_64, Bun 1.4.4, Node 26.13.0, TypeScript 6.0.3, Playwright Chromium 159. CI targets Node 24 and the same Bun version. This file distinguishes mock evidence from real native Service API evidence.

## Commands and results

| Gate | Result | Evidence scope |
| --- | --- | --- |
| `bun install` / `bun install --frozen-lockfile` | Pass | Exact dependency installation; restricted workspace cache paths documented in development guide |
| `bun run dev` | Pass | Vite listening and browser-loaded at `http://127.0.0.1:4173` |
| `bun run lint` | Pass | ESLint including TS and React hook rules, zero warnings |
| `bun run typecheck` | Pass | Strict app, tests, e2e, scripts and build-tool types |
| `bun run test` | 17 pass | Binary gRPC-Web framing/trailers, safe endpoint/auth metadata, state reducers, log bounds/reset/redaction, nanosecond/rate conversion, zero-millisecond probe results, selection confirmation/rejection/timeout, cancellation, reconnect and API revalidation after an outage |
| `bun run build` | Pass | Production SPA with relative assets, split feature/chart chunks and local font files |
| `bun run preview` | Pass | HTTP preview at loopback port 4273, title and relative asset references checked |
| `bun run proto:generate` | Pass, unchanged output | Local Buf/protoc-gen-es; generated SHA-256 unchanged before/after regeneration |
| `bun run licenses:generate` | Pass | 124 package/source notices, assertions reject missing license texts; committed build notice inventory |
| `bun run test:integration` with official 1.14.0 binary | 4 pass | Real native RPCs and server, detailed below |
| `bun run test:e2e` with official binary | 9 pass, 1 intentional skip | Eight mock/native-failure flows across desktop/mobile; one real native desktop browser flow; duplicate mobile native fixture skipped |
| GitHub Actions | Configured; equivalent local steps pass | Workflow has not been pushed or executed remotely in this task |

The vendored proto SHA-256 is `4feeac3166f38074888d9a5e04e69c5f92a178d2a2c3e94a963d2999ef4a3994`, matching the official release source byte-for-byte. Generated descriptor SHA-256 at initialization: `a01f056f869a2dfc8c30def87177ea7b9ee15a2593ea9a48315c812aad430a6b`.

## Real service tests (not mock)

Official Linux 1.14.0 binary from SagerNet's GitHub release, revision `0b8995879f29a9b98ee027bc17b75e101445b238`. Disposable mode-0600 config with random secret; only loopback listeners and local proxy/URL-test traffic. No private production configuration was used.

- `sing-box check` accepts the included sample configuration.
- Correct Bearer token returns core 1.14.0/API 4; incorrect token yields gRPC Unauthenticated.
- GetStartedAt and GetDefaultLogLevel return real metadata.
- SubscribeServiceStatus, SubscribeStatus, SubscribeGroups, SubscribeLog and SubscribeConnections produce decoded native messages, including reset semantics and available traffic tracking.
- SelectOutbound changes the group subscription's selected outbound; a nonexistent outbound produces NotFound.
- URLTest acknowledges a real local-test group and history appears in its group subscription. The fixture uses a local HTTP probe, not fabricated latency. An absent tag returns NotFound.
- A local HTTP request through the real mixed inbound creates tracked traffic; native CloseConnection/CloseAllConnections close it. The subsequent server snapshot excludes that active connection.
- GetClashModeStatus and SetClashMode correctly return NotFound without a configured mode manager. Successful mode changes on a mode-enabled instance remain unverified; the UI is P1.
- The actual server serves production `index.html` and relative JS assets under `/dashboard/`.
- CORS OPTIONS allows the configured development origin and omits allow-origin for an untrusted origin.
- Chromium connects from Vite's origin to the separate native API origin, tests credentials, selects an outbound through real streaming confirmation, and loads/navigates/reloads the built SPA under `/dashboard/#/logs`.

## Browser QA

Browser plugin classification: **absent**. Regular Playwright Chromium was used. Main entry: `http://127.0.0.1:4173`; native built-in path also tested. Automated desktop viewport is 1280×720; mobile is the iPhone 13 Chromium profile (390×664 CSS pixels). Visual review additionally used 1440×1000 and 390×844, with overflow checks at 320, 360 and 768px.

| Check | Result |
| --- | --- |
| Page identity/title and nonblank feature pages | Pass |
| No framework error overlay or relevant app console/page errors in healthy workflows | Pass |
| Light/dark/system theme rendering and system preference changes | Pass |
| Responsive rearrangement and no horizontal page overflow | Pass |
| Keyboard skip-to-content, route focus/navigation and modal dismissal | Pass |
| Route changes reset viewport; log autoscroll stays inside console | Pass |
| Proxy search, list/cards and server-confirmed selected state | Pass |
| Log pause/search/reset/export and bounded view | Pass |
| Connection details, single close, close-all cancellation/confirmation | Pass |
| Mock stream interruption/recovery and rejected mutations | Pass |
| Native failure remains native; token absent from persistent storage and URL | Pass |

Visual evidence was captured outside the repository and inspected alongside the generated concept. Desktop overview, proxies, connections, logs, settings, dark overview and mobile layouts share the same tokens, borders, type scale and navigation. Required API truth takes precedence over concept example values: API revision is 4, current metrics derive from streams, unsupported proxy/config editing controls shown by the concept generator were omitted. A discovered mobile scrolling issue was fixed by restricting log autoscroll to its viewport and resetting scroll on route changes.

## Remaining verification / limits

- Public VPS HTTPS/TLS certificate deployment, reverse-proxy streaming/buffering and browser private/local-network permission policies need environment-specific verification. Local CORS checks do not prove those environments.
- Firefox, WebKit, screen-reader/full WCAG audit, real hardware touch interaction and sustained 10,000-connection workloads were not tested. Caps and pagination are implemented; no production performance claim is made.
- Clipboard behavior depends on browser secure-context permissions; the UI provides an explicit failure message and export fallback. Export was browser-tested.
- Only stable core ≥1.14.0 with API 4 is accepted. New API revisions, prereleases, successful mode changes and P1/P2 tools need dedicated fixtures before claiming support.
- The native API deletes failed URL-test history; “No result” cannot reliably distinguish never tested from a failed test. UI copy states this limit.
- Remote GitHub CI, publication, pushing and deployment to a user's VPS were not performed. No access token or private config is included in source/builds. Downstream deployment must provide corresponding modified source under applicable licenses.
