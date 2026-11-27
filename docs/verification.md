# Verification record

Implementation validation: 2026-11-17, Linux x86_64, Bun 1.4.4, Node 26.13.0, TypeScript 6.0.3, Playwright Chromium 159. CI targets Node 24 and the same Bun version. This file distinguishes mock evidence from real native Service API evidence.

## Phase 1 — Native Diagnostics

Validation on 2026-11-27 used Linux x86_64, Bun 1.4.4, official sing-box v1.14.0 release revision `0b8995879f29a9b98ee027bc17b75e101445b238`, and Playwright Chromium. The released SingDeck v0.8.1 checkout at `dfb16e8` is the comparison baseline. Browser plugin was unavailable, so browser checks used Playwright directly.

| Check | Result and scope |
| --- | --- |
| Frozen install, lint, typecheck, and production build | Pass |
| Proto and license regeneration | Pass with no generated diff. The pinned schema is unchanged. |
| Unit tests | 112 pass, including capability discovery, warning retention and redaction, request slot switching, recovery action gating, duplicate inventory rows, pending cross-stream latency history, per-tag cooldown, diagnostic terminal semantics, and cancellation. |
| Official v1.14.0 integration | 12 pass across native SDK, diagnostics and built-in hosting suites. Fixtures used loopback API, HTTP and UDP endpoints, including a local dashboard archive download. No production services were accessed. |
| Chromium desktop and emulated mobile | 28 pass in the workspace and new Phase 1 suites, including Close all gating while the Connections subscription resumes. Feature interactions use the explicit demo. Four native fixture cases skip in this run because the native binary is excluded. Connection failure and credential persistence checks are separately scoped in the suite. |
| Chromium with official v1.14.0 | 2 pass in a separate desktop-only run. Covered cross-origin diagnostics and inventory, real selector confirmation, per-tag latency cooldown, navigation and reload under the built-in dashboard, credential behavior and viewport-safe latency feedback. |

The native integration tests streamed inventory including an ungrouped direct outbound and measured network quality using a paced HTTP fixture. STUN used loopback UDP responders with and without RFC 5780 support. The suite covered a missing outbound, an in-band diagnostic failure and an abort that closed a pending core HTTP request. The pinned CLI fixture emitted a DNS deprecation in logs and returned an empty warning list. [Native integration](../tests/native.integration.test.ts) · [Diagnostic integration](../tests/diagnostics.integration.test.ts)

Additional controlled local checks against official binaries:

- `SubscribeOutbounds` on v1.14.0 returned a configured userspace WireGuard endpoint alongside a direct outbound. The endpoint row exposed its tag, native `wireguard` type and zero-valued test history. The API provides no separate endpoint field. This check used a loopback peer and exercised inventory only.
- The official v1.14.0 SFL Linux daemon returned a nonempty deprecation warning, including its version fields and migration anchor. A second unary returned an empty list, confirming drain semantics. Chromium rendered the warning, preserved it across refresh in the same core lifetime, and recovered after a managed reload with a new start time and a different warning. A same-origin production rerun delayed delivery of the new warning by 2.5 seconds. The browser made one warning request and retained its result.
- Chromium confirmed the API used HTTP/1.1. Six permanent subscriptions queued additional calls. The shared fifth stream slot allowed the warning-refresh unary to run, and retrying server-canceled subscriptions restored live monitoring after reload.
- The v1.14.0 QUIC build negotiated HTTP/3 with a loopback Caddy measurement fixture using a trusted temporary certificate. Both capacities completed with positive native values. The v1.14.0 direct outbound failed the literal-IP STUN case. The v1.14.5 official binary completed it with the same UDP fixture.
- Chromium exchanged interleaved authenticated USB-provider messages and a client half-close with the official WebSocket bridge. Missing credentials returned Unauthenticated. The server accepted an Origin outside the HTTP CORS list. The proof used an absent service tag without hardware and does not verify USB operations or production TLS and reverse proxies. [Transport notes](api-compatibility.md)

Phase 1 trust checks verified that explicit diagnostics wait for a user action, require consent for a custom core-side destination, suppress raw RPC error details, reject nonofficial migration links, and omit the custom configuration URL from exports. Custom STUN consent covers alternate addresses or ports supplied by the server for NAT behavior discovery. Report and comparison history remain in memory. STUN reports intentionally include the external address when the user copies or exports one. Credential persistence and TLS policy retain the existing scope. Full browser/proxy compatibility, broader security review and high-volume performance remain later gates.

### Browser performance and rendering

In the final production build, initial HTML-declared JavaScript and CSS, including preloads, grew from 210,795 to 219,183 gzip bytes (+3.98%). Total emitted JavaScript and CSS grew from 330,777 to 356,471 bytes (+7.77%). These totals were measured by compressing each emitted asset separately at gzip level 9 and exclude HTML and fonts. Diagnostics and Configuration Health are lazy routes.

A prefinal candidate and the `dfb16e8` baseline were measured with Chromium 159 at 1280×800 on a Linux x86_64 2-vCPU workstation, using unthrottled loopback static hosting. The median first animation frame with **Explore demo** visible moved from 197 to 242 ms with a cold cache and from 103 to 103 ms with a warm cache. The click-to-**Connected** and Overview median moved from 471 to 312 ms cold and from 442 to 262 ms warm. Each build had 12 interleaved samples after one warmup. Host workload and timing varied, so these are local observations. Workload, long-run and real network measurements are Phase 5 gates.

Visual inspection of a prefinal candidate used desktop light and emulated mobile dark screenshots, plus 320–1440 CSS pixel checks for layout overflow. Screenshots used demo inputs without private instance data. Desktop and mobile browser tests distinguish demo interactions from real-core browser coverage.

## Phase 2 — Runtime Monitor

The official sing-box v1.14.0 Linux integration measures the received runtime counters and rate conversions. It waits across four status intervals while the lifecycle stream stays quiet, then sends SIGHUP and checks that the changed native service start time records one restart and a gap in the rate history. The mock unit tests cover the observation limits, counter resets, and gaps after late frames. Browser history is bounded to the current session.

## Phase 2 — Core log buffer and browsing

An active subscriber received a reset after an authenticated `ClearLogs` call on official sing-box 1.14.0 over loopback. Browser checks use explicit demo mode for the confirmation and cancellation flows, local-only clearing, ANSI rendering and filtered export. The core action clears the shared in-memory history after confirmation. The local action clears the current browser view. Exports are explicit local files using filtered plain text with the active API credential redacted. The scale fixture and screenshots used synthetic data outside the repository.

A local comparison used production builds on loopback with Chromium 159.0.8154.6. Each viewport received 2,505 synthetic ANSI messages across the initial burst and five append batches. Both builds retained 2,000 messages. The paged build rendered at most 200 rows and exported all 500 matches from the tested level and source filters. Older and newer controls reached the boundary pages, and Resume returned to live rows. The timings are single local observations of the isolated builds.

| CSS viewport | Initial log view before → paged | Clear search before → paged |
| --- | ---: | ---: |
| Desktop 1280 × 720 | 4,652 → 722 ms | 3,045 → 294 ms |
| Emulated mobile 320 × 700 | 4,209 → 679 ms | 4,036 → 283 ms |

## Phase 4 — USB/IP Server status

An official sing-box v1.14.0 Linux loopback fixture returned a named, configured dynamic server with an empty device list through authenticated HTTP gRPC-Web. A fixture without the dynamic service returned an empty server list. An incorrect Bearer was rejected as Unauthenticated. Both fixtures used synthetic credentials and no attached devices.

Chromium desktop and emulated mobile opened the status view under Settings against the official configured service from a local production build. The subscription began when the view opened, displayed the service name and zero shared devices, and was canceled when the view closed. The browser checks also covered horizontal overflow. The session regression covers raw and encoded credential redaction, late-frame rejection, restoration of the Connections stream, and the distinction between an empty result and NotFound. The view regressions cover stopped and fatal services, and metadata revalidation failure before or after the first USB/IP frame. The browser regression also checks keyboard entry focuses the USB/IP heading. Real-device descriptors and hardware behavior await a device fixture. [Browser regression](../e2e/usbip.spec.ts) · [Session tests](../tests/session.test.ts)

## Phase 5 — Connections capacity baseline

The baseline uses application source `ec030fb`, Bun 1.4.4, Playwright 1.65.1 and headless Chromium 159.0.8154.6 at 1280 × 720 on a shared Linux x86_64 host with two available CPUs. The [measurement script](../scripts/measure-connection-capacity.ts) serves an isolated production-mode fixture build on `127.0.0.1:15926` and blocks browser requests to other origins. The initial reset seeds active connections and closed history. The test reads both through the status filter and observes subsequent traffic updates on active rows. The fixture build emitted 376,544 gzip bytes of JS and CSS, compressed individually.

Run `bun scripts/measure-connection-capacity.ts` after the frozen install with the pinned Playwright Chromium available. The script requires clean application source and configuration and disables Vite env-file loading during the build. The printed JSON report records application HEAD, worktree changes and SHA-256 hashes for the script and this document as measured. Only those two files had local changes in the recorded run.

All cases use one browser process and fresh contexts, with one discarded warmup and three alternating runs per in-limit workload. Timings include Playwright actions, assertions and two animation frames. Explore demo to first rows includes the startup and Connections navigation. Connected to rows starts after the workspace reports Connected, when connection data may already be available. The long-task window ends after returning from Diagnostics for every case, before the separate eight-second update observation. Heap samples use Chromium CDP without forcing garbage collection.

| Synthetic input | Retained active / closed | Explore demo / Connected to rows median | Search / clear median | Next page median | Return from Diagnostics median | First-page heap median | Longest observed task |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 799 / 201 | 401 / 197 ms | 226 / 133 ms | 118 ms | 344 ms | 12.6 MiB | 84 ms |
| 10,000 | 7,999 / 2,001 | 567 / 306 ms | 226 / 133 ms | 117 ms | 371 ms | 29.1 MiB | 236 ms |

The 12,000-record smoke retained 9,599 active and 401 closed records, showed the display-limit notice and kept the 50-row page. Its longest task was 224 ms. In one 10,000-record sample, traffic values changed during the eight-second update observation after the timed work. Heap use went from 50.1 to 45.1 MiB during that observation. These are short synthetic measurements on a shared host. Long-run memory behavior and real-core throughput need separate measurements.

One ten-minute follow-up at `5404626` used the same 10,000-record synthetic fixture in a foreground Chromium 159.0.8154.6 context at 1280 × 720. The initial list had 7,999 active and 2,001 closed records. At the start and each of ten one-minute checkpoints, **All statuses** retained 10,000 records and displayed 50 rows on page 1 of 200. The displayed upload counter on one mock row advanced from 12 KB to 1.7 MB. Unforced Chromium JS heap samples ranged from 34.2 to 53.2 MiB and ended at 34.2 MiB. After setup, the browser observed 131 tasks of at least 50 ms, with a maximum of 444 ms. Browser errors, failed requests and off-origin attempts stayed at zero. This single shared-host run covers bounded synthetic updates over ten minutes. Longer memory behavior and real-core throughput remain separate checks.

## Phase 5 — Outbound inventory capacity baseline

Run `bun scripts/measure-outbound-capacity.ts` after the frozen install with the pinned Playwright Chromium available. The [script](../scripts/measure-outbound-capacity.ts) builds a disposable production-mode fixture, adds synthetic tags to the explicit demo inventory and blocks requests outside its loopback origin. The JSON report records application HEAD, worktree status, the measurement script hash and raw samples.

The initial run used source `845ce6c`, Bun 1.4.4, Playwright 1.65.1 and headless Chromium 159.0.8154.6 at 1280 × 720 on shared Linux x86_64 with two available CPUs. One browser process ran a discarded 1,000-row warmup, then three runs in fixed order from 1,000 to 20,000 rows using fresh contexts. Inventory time begins after the Outbounds navigation click and includes any wait for the **All outbounds** control. Search finds the last synthetic tag. Both timings include Playwright actions, assertions and two animation frames. Heap is sampled after the inventory renders without forced collection. The longest task is the maximum observed from before inventory selection through visible search results.

| Synthetic input | Rows rendered per page | Inventory median | Exact tag search median | Heap median | Longest observed task |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 60 | 772 ms | 110 ms | 11.7 MiB | 161 ms |
| 10,000 | 60 | 757 ms | 159 ms | 13.9 MiB | 304 ms |
| 20,000 | 60 | 1,224 ms | 229 ms | 16.7 MiB | 492 ms |

Pagination bounded mounted rows in every run. The timings varied under shared host load and cover first display and one search. Real-core throughput, repeated stream churn and multi-group scale require separate measurements.

One separate CPU profile used `98347c4`, the same browser, viewport and synthetic 20,000-row fixture. Outbounds navigation to visible controls took 852 ms with no task of at least 50 ms. Selecting **All outbounds** to the first 60 rows took 346 ms with a 106 ms long task. Exact tag search took 87 ms. During the inventory phase, sampled inclusive stack time was about 108 ms for React and DOM work, 37 ms for mock acquisition and Protobuf cloning, 13 ms for inventory filtering, mapping and sorting, and 1 ms for indexing. Garbage collection accounted for about 41 ms. These categories can overlap. This single observed long task was shorter than the earlier 20,000-row samples, and the profile did not attribute their long tasks or measure a real core.

## Phase 5 — High-volume core log fixture

At `c08b35a`, two fresh Chromium 159.0.8154.6 contexts used the production app with explicit demo mode and synthetic ANSI messages at 1280 × 720. A 1,000-message reset retained all 1,000 messages. The 12,000-message case applied the same reset and eleven 1,000-message appends, checking the latest displayed sequence after each batch. It retained exactly the latest 2,000 messages. The adjacent evicted sequence was absent from search. Both cases mounted at most 200 rows, showed the expected bold styling and exported one searched latest row as plain text without ANSI escapes. There were no page errors or off-origin requests.

In the 12,000-message case, browser dispatch through visible assertions took 167–329 ms per append. The live measurement window contained four long tasks with a maximum of 95 ms. The JS heap sample was 24.1 MiB without forced collection. These are single synthetic runs. Real-core logging throughput and long-run memory behavior require separate measurements.

## Phase 5 — Local browser and HTTPS compatibility

CI runs Chromium on desktop and with a mobile device profile. These local desktop Linux smoke checks use production builds and Playwright 1.65.1. [CI browser configuration](../playwright.config.ts)

- At `bcb7ee85`, Firefox 159.0 (revision 1572) and WebKit 27.2 (revision 2388) each loaded 19 assets from a static `/preview/` mount and rendered 28 Connections rows after explicitly starting Demo. Reload preserved the route URL. Starting Demo again restored access to the route. Both engines also connected over cross-origin loopback HTTP to official sing-box 1.14.0. The core rejected an incorrect Bearer token and accepted the valid test token on API 4. Remember was off by default. Explicitly enabling it restored the Logs route after reload. The token was absent from localStorage and sessionStorage. Both engines recorded zero page errors and zero failed asset requests.
- At `16a4ac58`, the same Firefox build negotiated TLS 1.3 for `/preview/` and the separate API origin. Caddy 2.11.9 forwarded API calls to official sing-box 1.14.0 over loopback HTTP. CORS allowed the configured origin to send `Authorization` and the gRPC-Web headers, and omitted the allow-origin header for an unapproved origin. Authenticated `GetVersion` and `SubscribeStatus` each returned HTTP 200 over gRPC-Web. Runtime reported the status stream as Live and its last-received timestamp advanced on the next frame. The page reported zero runtime errors.
- At `845ce6c`, Chromium 159.0.8154.6 loaded `/dashboard/#/runtime-monitor` from official sing-box 1.14.0 through a disposable OpenSSH 10.0p2 loopback forward. It inferred the forwarded origin, the core rejected an incorrect Bearer, and valid credentials reached API 4. Runtime reported the service and status streams as Live, and the displayed last-received timestamp advanced. Reload preserved the route and cleared the unremembered token. The browser reported zero page errors and zero requests outside the forwarded origin. The forwarded HTML matched the production candidate byte for byte. The SSH server required the disposable public key, preserved pre-authentication isolation and permitted only the API forward. The client pinned the temporary host key. Closing SSH closed the forwarded listener while the loopback core remained reachable. Temporary credentials, server and browser processes, and listeners were cleaned up.

Firefox required an approved exception to the workspace execution sandbox to start its content processes. Firefox's own content sandbox and certificate validation remained enabled. The HTTPS test CA was trusted only in a disposable NSS profile. A fresh profile rejected both HTTPS origins with `SEC_ERROR_UNKNOWN_ISSUER`. Public-origin Private Network Access (PNA), real TLS deployments and physical mobile devices still need validation. [Browser security and deployment](api-compatibility.md#browser-security-and-deployment) · [Independent static hosting](deployment.md#b-independent-static-hosting)

### Content Security Policy smoke

At `f28375e`, Chromium 159.0.8154.6 loaded the production app from static `/preview/` with a test response header using `default-src 'none'`, same-origin scripts, styles, images and fonts, and `connect-src` limited to the exact loopback API origin. The app connected to official sing-box 1.14.0 on API 4, rendered the runtime charts and reported a Live status stream with no browser errors or policy violations. A separate loopback destination was blocked by `connect-src` before its listener received a request. This check covers the Runtime Monitor path with a host-managed header. [CSP connect-src](https://www.w3.org/TR/CSP3/#directive-connect-src)

## v0.3.0 local regression record

Worktree feature validation on 2026-11-17: lint, typecheck, production build, frozen installation, actionlint, schema regeneration and license reproducibility pass. Unit tests: **26 pass**. Official sing-box 1.14.0 integration: **5 pass**, including download of a root-layout ZIP from a loopback HTTP fixture, extraction into a new directory and serving HTML/assets under `/dashboard/`. This proves core archive handling; it does not prove a user's GitHub download route.

Desktop/mobile Playwright: **21 pass, 1 intentional duplicate native mobile fixture skip**. The real native browser test checks API CORS and built-in hosting; product feature interactions use explicit mock mode. Covered: separate group/node card controls, collapsed groups, Active/Closed history and filtering, disabled close actions for closed rows, INFO threshold including WARN/ERROR while excluding DEBUG/TRACE, English/Chinese switches, persistent theme/language, current-connection menu/disconnect and absence of removed Settings/profile/sandbox controls. Session unit coverage keeps outage/rejection/cancellation and verifies closed history is evicted before active records at the memory cap.

Visual QA used Playwright (Browser plugin absent), 1440×1000 desktop and 390×844 mobile, with overflow checks at 320/390/768/1440px. Light/dark and English/Chinese views were inspected. Per-page slogans no longer consume body space; navigation hover/focus exposes descriptions. Screenshots are outside source control. Tagged release CI repeats these checks; its final status is recorded on GitHub, not inferred from local validation.

The following sections preserve the **initial implementation** record and its original limits; they are not the v0.3.0 test counts or publication status.

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
