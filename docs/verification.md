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
- At `ccb84bd`, Chromium 159.0.8154.6 used the production dashboard to run two separately authorized two-second quality tests against official sing-box 1.14.0/API 4. Both selected outbound tags matched the native requests and the distinct source addresses seen by a paced loopback HTTP fixture. The comparison kept both reports and matched the native capacity values of 12.7 down and 50.8 up, then 25.5 down and 67.7 up, in Mbit/s. Both idle latencies were 2 ms. The core returned zero for RPM and the interface showed it as unavailable. These are paced loopback observations.

Phase 1 trust checks verified that explicit diagnostics wait for a user action, require consent for a custom core-side destination, suppress raw RPC error details, reject nonofficial migration links, and omit the custom configuration URL from exports. Custom STUN consent covers alternate addresses or ports supplied by the server for NAT behavior discovery. Report and comparison history remain in memory. STUN reports intentionally include the external address when the user copies or exports one. Credential persistence and TLS policy retain the existing scope. Full browser/proxy compatibility, broader security review and high-volume performance remain later gates.

### Browser performance and rendering

In the final production build, initial HTML-declared JavaScript and CSS, including preloads, grew from 210,795 to 219,183 gzip bytes (+3.98%). Total emitted JavaScript and CSS grew from 330,777 to 356,471 bytes (+7.77%). These totals were measured by compressing each emitted asset separately at gzip level 9 and exclude HTML and fonts. Diagnostics and Configuration Health are lazy routes.

A prefinal candidate and the `dfb16e8` baseline were measured with Chromium 159 at 1280×800 on a Linux x86_64 2-vCPU workstation, using unthrottled loopback static hosting. The median first animation frame with **Explore demo** visible moved from 197 to 242 ms with a cold cache and from 103 to 103 ms with a warm cache. The click-to-**Connected** and Overview median moved from 471 to 312 ms cold and from 442 to 262 ms warm. Each build had 12 interleaved samples after one warmup. Host workload and timing varied, so these are local observations. Workload, long-run and real network measurements are Phase 5 gates.

Visual inspection of a prefinal candidate used desktop light and emulated mobile dark screenshots, plus 320–1440 CSS pixel checks for layout overflow. Screenshots used demo inputs without private instance data. Desktop and mobile browser tests distinguish demo interactions from real-core browser coverage.

## Phase 2 — Runtime Monitor

The official sing-box v1.14.0 Linux integration measures the received runtime counters and rate conversions. It waits across four status intervals while the lifecycle stream stays quiet, then sends SIGHUP and checks that the changed native service start time records one restart and a gap in the rate history. The mock unit tests cover the observation limits, counter resets, and gaps after late frames. Browser history is bounded to the current session.

**Clear older chart samples** removes earlier in-memory samples from the current session and keeps the newest sample. Runtime Monitor and Overview use that same buffer. Current readings, service events and stream receipt times stay in place. New samples continue to arrive through the existing stream.

**Clear service event history** empties the current session's in-memory timeline. Runtime Monitor keeps the current readings, chart samples and stream receipt times. A confirmed restart marks the prior sample as stale until the next status sample arrives, including when the restart and prior sample share a receipt timestamp. Clearing the timeline leaves that freshness check in place. Later lifecycle and status-stream events appear in the cleared timeline.

In Chromium 159.0.8154.6 on the official sing-box 1.14.0 built-in dashboard, clearing by keyboard emptied a real service event timeline while keeping the memory curve and status and lifecycle receipt times. Both subscriptions stayed live. The next status frame advanced its receipt time, and returning to Runtime Monitor showed the cleared timeline in the same session.

In a separate run with the same production build and official core, stopping the disposable loopback core after clearing added a stream interruption to the empty timeline. Restarting the core on the same endpoint produced stream recovery and core restart entries, and fresh status and lifecycle frames arrived. The same workspace retained its earlier chart without a new login.

In a local production Chromium run with official sing-box 1.14.0/API 4, **Clear older chart samples** reduced a populated memory curve to its newest marker. The visible memory and traffic readings and the exact status and lifecycle receipt times stayed the same. Both streams stayed Live. The next regular status sample extended the curve and made the action available again. The browser used one status subscription and made no mutation request in this fixture.

The chart-sample regression also clears while a newer status sample is queued for publication. The clear publishes that exact sample and leaves lifecycle events, stream state and sibling receipt times intact. Desktop and 320px mobile Demo tests separately check keyboard or touch, retained readings, new samples, the wider window and the same cleared buffer after navigating through Overview.

## Phase 2 — Per-connection observed rates

A production Chromium 159.0.8154.6 browser connected to the built-in dashboard on official sing-box 1.14.0/API 4 with a one-second Connections interval. An isolated TCP fixture sent 128 B up and 256 B down after the inspector opened. The first live update established the baseline and both rates stayed unavailable. The next update of 192 B up and 384 B down displayed 192 B/s and 384 B/s in that run. Reported interval fields kept their original byte values.

A zero marker and the ensuing idle period cleared the rates. A fresh update reestablished a baseline. The next one-way update showed 320 B/s up and 0 B/s down, and the confirmed close cleared both rates again. The browser used one native Connections subscription. The amounts and timings describe this loopback fixture and its browser observations. Chromium desktop and emulated mobile tests separately exercise Demo rate display, an observation gap, resumption and inspector reopening.

### Linux process metadata

At `ccb84bd`, one owned TCP fixture connection ran in isolated network and PID namespaces. The official sing-box 1.14.0/API 4 native record matched the fixture's executable, UID and user name. Chromium's Connection Inspector showed those fields and a Process route step. A matching filter returned that row, a nonmatching filter excluded it, and the one-row JSON export matched the native attributes. The core supplied neither a PID nor Android package names for this fixture, and those fields stayed unavailable in the view.

### Native connection filters and route chain

At `ccb84bd`, official sing-box 1.14.0/API 4 and Chromium 159.0.8154.6 observed three controlled loopback connections. The native attributes were TCP/IPv4 HTTP, UDP/IPv4 DNS and UDP/IPv6 DNS. Combined network, IP-family and application-protocol filters returned the expected rows or no match. Keyboard **Clear filters** restored all three. Inspector preserved the bracketed IPv6 destination from the native record. The browser used one HTTP 200 gRPC-Web Connections subscription.

In a separate controlled connection with the same build and core, an explicit inbound rule selected an outer group, an inner group and a direct leaf. The native chain ran from leaf to inner to outer, and native `outbound` identified the leaf. Inspector showed Inbound, Matched rule, Outbound chain in outer-to-leaf order, and Destination. The Outbound field identified the leaf. The core omitted `fromOutbound`, so the field displayed Unavailable. The exact rule matched one row, a different rule matched none, and clearing restored the row without opening another browser subscription.

### Closed connection history

The **Closed** view offers an optional **Closed at** column with millisecond precision. It starts hidden, and the default remains **Start time** descending. In Chromium 159.0.8154.6 using the official 1.14.0/API 4 built-in dashboard in a loopback-only namespace, two real connections closed in reverse creation order, 146 ms apart within the same second. Both rendered timestamps matched the native milliseconds, and both close-time sort directions gave the expected order. Hiding or resetting the column, selecting **All statuses**, and clearing filters each restored the default from the close-time sort. The browser used one live Connections subscription throughout. Desktop and 320px mobile Demo coverage separately verified keyboard controls and records with close times 1 ms apart.

## Phase 2 — Native notifications

At `ccb84bd`, Chromium 159.0.8154.6 used a source-built `v1.14.0` fixture with a synthetic in-process producer. The upstream daemon observer and authenticated gRPC-Web served the notifications page in an isolated loopback-only namespace. A wrong Bearer was rejected. The browser kept two events with the same identifier and different types separate. A type-mismatched cancel affected neither. A matching cancel marked only its target canceled and read, and the other item remained unread.

Leaving the page closed the browser observer. An independent observer received a notice while the browser was away. Returning opened a quiet subscription and kept the browser's two existing records without replay. A fresh event arrived on the new subscription. The tested notification URL and shared identifier stayed out of the page. The fixture text and Bearer were absent from Web Storage and IndexedDB. Separate checks with the official release CLI verified live idle subscription and teardown on route exit.

The `ccb84bd` production build ran in headed Chromium 159.0.8154.6 in a disposable profile under Xvfb and an isolated loopback network namespace. The dashboard button opened Chromium's notification permission prompt. XTest activated **Allow** and the permission changed from default to granted. A foreground Demo STUN completion made no desktop notification request. After selecting another browser tab, a Demo network quality completion in the hidden workspace sent one SingDeck notification containing the fixed completion text to a private Linux D-Bus notification service. A new native-source Demo event arrived in the hidden workspace without an additional desktop notification. This verifies Chromium delivery to the Linux notification service.

## Phase 2 — Local outbound group disclosure

At `9687377`, Chromium against official sing-box 1.14.0/API 4 used the keyboard to open one of two groups. The same group remained open after returning from Logs and from All outbounds, and the other stayed collapsed. Disconnect and reconnection in the same tab returned both groups to their initial collapsed state. Changing the group disclosure left Web Storage unchanged, and the browser sent no native mutation. The checked-in desktop and emulated mobile Demo regression also verifies temporary filtering. A separate synthetic stream sent an empty frame and then the original list, which kept the open group. After a subsequent nonempty list omitted that group, it returned collapsed when it reappeared. [Native browser regression](../e2e/native.spec.ts) · [Demo browser regression](../e2e/workspace.spec.ts)

## Phase 2 — Core log buffer and browsing

An active subscriber received a reset after an authenticated `ClearLogs` call on official sing-box 1.14.0 over loopback. Browser checks use explicit demo mode for the confirmation and cancellation flows, local-only clearing, ANSI rendering and filtered export. The core action clears the shared in-memory history after confirmation. The local action clears the current browser view. Exports are explicit local files using filtered plain text with the active API credential redacted. The scale fixture and screenshots used synthetic data outside the repository.

A local comparison used production builds on loopback with Chromium 159.0.8154.6. Each viewport received 2,505 synthetic ANSI messages across the initial burst and five append batches. Both builds retained 2,000 messages. The paged build rendered at most 200 rows and exported all 500 matches from the tested level and source filters. Older and newer controls reached the boundary pages, and Resume returned to live rows. The timings are single local observations of the isolated builds.

| CSS viewport | Initial log view before → paged | Clear search before → paged |
| --- | ---: | ---: |
| Desktop 1280 × 720 | 4,652 → 722 ms | 3,045 → 294 ms |
| Emulated mobile 320 × 700 | 4,209 → 679 ms | 4,036 → 283 ms |

## Phase 4 — Taildrop inbox and download

An official sing-box 1.14.0/API 4 Linux fixture ran in a loopback-only network namespace. Its named Tailscale endpoint stayed in `NeedsLogin` with zero peers while the authenticated HTTP gRPC-Web inbox stream reported one preseeded completed file. The reported name, size and modification time matched the file.

Downloading the 4,194,357-byte file returned a size frame and 258 data frames. The largest data frame carried 16,320 bytes, and the assembled SHA-256 matched the fixture file. A missing filename returned `NotFound`. In a second download, closing the client after one data frame released the core's open file handle. The file checksum stayed intact and the API remained responsive. This check covers seeded inbox listing and download cancellation. Live peer receipt, sender metadata, send progress and inbox mutations still need separate verification.

### Browser storage research

In a separate loopback-only fixture, a standalone Chromium 159.0.8154.6 harness downloaded a seeded Taildrop file from official sing-box 1.14.0/API 4 through authenticated Connect gRPC-Web. The browser awaited all 258 writes to its disposable origin-private file system (OPFS) and held at most one application-owned payload chunk. Its largest chunk was 16,320 bytes. Readback in chunks of at most 32 KiB produced a SHA-256 matching the 4,194,357-byte source. A separate cancellation after the first write removed the partial local entry. The harness rejected a declared size above a configured 1 MiB cap before it consumed a data frame or created a file. These measurements cover application-held chunks and local cleanup. Browser internal buffering, real peer transfers and integration into SingDeck need separate evidence.

An ephemeral Firefox 159.0 context and a disposable WebKit 27.2 profile backed by disk each wrote and read back 20,771 synthetic bytes through awaited origin-private storage writes. Aborting another write left a zero-byte entry that was removed. The tested ephemeral WebKit context exposed `getDirectory()` and returned `UnknownError` when it was called. These small sink checks cover browser API feasibility.

## Phase 4 — USB/IP Server status

An official sing-box v1.14.0 Linux loopback fixture returned a named, configured dynamic server with an empty device list through authenticated HTTP gRPC-Web. A fixture without the dynamic service returned an empty server list. An incorrect Bearer was rejected as Unauthenticated. Both fixtures used synthetic credentials and no attached devices.

Chromium desktop and emulated mobile opened the status view under Settings against the official configured service from a local production build. The subscription began when the view opened, displayed the service name and zero shared devices, and was canceled when the view closed. The browser checks also covered horizontal overflow. The session regression covers raw and encoded credential redaction, late-frame rejection, restoration of the Connections stream, and the distinction between an empty result and NotFound. The view regressions cover stopped and fatal services, and metadata revalidation failure before or after the first USB/IP frame. The browser regression also checks keyboard entry focuses the USB/IP heading. Real-device descriptors and hardware behavior await a device fixture. [Browser regression](../e2e/usbip.spec.ts) · [Session tests](../tests/session.test.ts)

At `c87a20a`, an isolated software fixture registered one inert synthetic descriptor with the dynamic service in official sing-box 1.14.0. Native API 4 reported the expected descriptor and interface fields, `DYNAMIC` backend and `IDLE` state. Both the raw authenticated status stream and the unmodified Chromium 159.0.8154.6 Settings view observed counts of `0 → 1 → 0` when the fixture registered and disconnected. The app displayed the shared count, kept the synthetic serial out of the page, used one status subscription and canceled it on route exit.

A follow-up ran entirely in userspace in a loopback-only Linux namespace with official sing-box 1.14.0/API 4. A software provider registered an inert device over authenticated `grpc-websockets`. A TCP client imported the device and sent one `GET_DESCRIPTOR` control request. The provider matched the request sequence and returned the expected 18-byte synthetic descriptor. The TCP completion carried the original client sequence, status `0` and the same bytes. After the client and provider closed their connections, the native device count returned to zero and the API still responded. [Linux USB/IP protocol](https://docs.kernel.org/usb/usbip_protocol.html)

A separate fixture held one software control request pending. The provider received a cancellation for the same device and control endpoint. The TCP unlink reply reported `ECONNRESET`. On the same imported device session, the next request completed with status `0` and the expected 18-byte descriptor. Clean disconnect returned the device count to zero. Browser device permissions, physical transfers and unplug behavior, and browser-provider cancellation remain separate checks.

## Phase 4 — WebSocket proxy and cancellation research

At `1fd28e9`, a standalone Firefox 159.0 fixture used TLS 1.3 with a disposable CA trusted in its temporary profile. Same-origin WSS through Debian Nginx 1.26.3 upgraded successfully at the proxy and official sing-box 1.14.0. The browser negotiated `grpc-websockets` and received two authenticated `SubscribeStatus` frames with native runtime values, about one second apart. Canceling the open subscription produced a clean browser close and released the upstream TCP connection. Nginx denied a request from a separate local frontend origin with HTTP 403 before any upstream request. This check covers transport and socket teardown on that loopback configuration. [Nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html) · [Official bridge](https://github.com/SagerNet/sing-box/blob/0b8995879f29a9b98ee027bc17b75e101445b238/service/api/web_bridge_websocket.go)

Feature acceptance still requires separately measured send and receive bounds and cancellation while work is in progress. The core limit applies per incoming message, and the browser's `bufferedAmount` measures its local send queue. Taildrop sending needs a controlled receiving peer to check completion, content and cancellation. Tailscale SSH needs a controlled peer to check startup, terminal errors and cleanup. Browser USB/IP provision needs an authorized device fixture to check permissions, transfer completion and removal. These three browser features remain blocked. [WebSocket send queue](https://websockets.spec.whatwg.org/#dom-websocket-bufferedamount) · [Native capability matrix](native-api-capabilities.md#browser-bidirectional-transport)

## Phase 5 — Connections capacity baseline

The baseline uses application source `ec030fb`, Bun 1.4.4, Playwright 1.65.1 and headless Chromium 159.0.8154.6 at 1280 × 720 on a shared Linux x86_64 host with two available CPUs. The [measurement script](../scripts/measure-connection-capacity.ts) serves an isolated production-mode fixture build on `127.0.0.1:15926` and blocks browser requests to other origins. The initial reset seeds active connections and closed history. The test reads both through the status filter and observes subsequent traffic updates on active rows. The fixture build emitted 376,544 gzip bytes of JS and CSS, compressed individually.

Run `bun scripts/measure-connection-capacity.ts` after the frozen install with the pinned Playwright Chromium available. The script requires clean application source and configuration and disables Vite env-file loading during the build. The printed JSON report records application HEAD, worktree changes and SHA-256 hashes for the script and this document as measured. Only those two files had local changes in the recorded run.

All cases use one browser process and fresh contexts, with one discarded warmup and three alternating runs per in-limit workload. Timings include Playwright actions, assertions and two animation frames. Explore demo to first rows includes the startup and Connections navigation. Connected to rows starts after the workspace reports Connected, when connection data may already be available. The long-task window ends after returning from Diagnostics for every case, before the separate eight-second update observation. Heap samples use Chromium CDP without forcing garbage collection.

| Synthetic input | Retained active / closed | Explore demo / Connected to rows median | Search / clear median | Next page median | Return from Diagnostics median | First-page heap median | Longest observed task |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 799 / 201 | 401 / 197 ms | 226 / 133 ms | 118 ms | 344 ms | 12.6 MiB | 84 ms |
| 10,000 | 7,999 / 2,001 | 567 / 306 ms | 226 / 133 ms | 117 ms | 371 ms | 29.1 MiB | 236 ms |

The 12,000-record smoke retained 9,599 active and 401 closed records, showed the display-limit notice and kept the 50-row page. Its longest task was 224 ms. In one 10,000-record sample, traffic values changed during the eight-second update observation after the timed work. Heap use went from 50.1 to 45.1 MiB during that observation. These are short synthetic measurements on a shared host.

One ten-minute follow-up at `5404626` used the same 10,000-record synthetic fixture in a foreground Chromium 159.0.8154.6 context at 1280 × 720. The initial list had 7,999 active and 2,001 closed records. At the start and each of ten one-minute checkpoints, **All statuses** retained 10,000 records and displayed 50 rows on page 1 of 200. The displayed upload counter on one mock row advanced from 12 KB to 1.7 MB. Unforced Chromium JS heap samples ranged from 34.2 to 53.2 MiB and ended at 34.2 MiB. After setup, the browser observed 131 tasks of at least 50 ms, with a maximum of 444 ms. Browser errors, failed requests and off-origin attempts stayed at zero. This single shared-host run covers bounded synthetic updates over ten minutes.

### Native TCP connection baseline

At `ccb84bd`, official sing-box 1.14.0/API 4 served the production dashboard to Chromium 159.0.8154.6 at 1280 × 720 in an isolated loopback-only Linux namespace. The fixture opened 50 TCP flows at a time with a 100 ms pause between batches. The native subscriber and browser both reported 1,000 active connections. The browser displayed 50 rows per page, stayed on page 2 of 20 and used one HTTP 200 gRPC-Web Connections subscription.

Three controlled traffic rounds on all 1,000 sockets delivered 512,000, 1,024,000 and 2,048,000 bytes. The native stream reported 1,000 positive updates per round, with subsequent update receipts 995 and 1,000 ms apart. During a two-second update observation, unforced browser JS heap samples were 14.1 and 18.5 MiB and no task of at least 50 ms was recorded. Longer retention and higher-volume native throughput remain separate measurements.

A separate ramp used the same production build, native core, Chromium viewport and loopback isolation. At the 2,500-flow checkpoint, the native subscriber and browser both reported 2,500 active connections and the browser rendered 50 rows. The fixture stopped after opening 3,250 socket pairs when the host's available memory reached about 529 MiB, below its configured 560 MiB reserve. The fixture closed all sockets and listeners. A 10,000-flow run and traffic updates above the earlier 1,000-flow baseline remain unverified.

A separate bounded churn run used the same production build, native core and loopback isolation. It opened and closed 10,200 TCP flows over time, with at most 400 simultaneously active. The native observer recorded distinct creation and close events for each flow. Chromium showed 10,000 retained closed records across 200 pages and mounted 50 rows on page 2. With another 200 flows active at the cap, the browser retained all 200 active records, 9,800 closed records and the 10,000-record limit notice. Once all flows closed, the dashboard again retained 10,000 closed records on the same Connections subscription. During this roughly 39-second run, unforced Chromium JS heap samples were 8.1 and 26.6 MiB, with 13 tasks of at least 50 ms and a maximum of 91 ms. These observations cover bounded connection churn and retained history. The preceding ramp measures simultaneous activity separately.

### Connections table copies between publications

A separate Chromium CPU profile of the bounded native churn sampled the connection-event reducer and garbage collection 147 times each within 427 samples in long tasks. The profile locates work in the reducer and the collector. It leaves the individual cost of copying the table unresolved.

Two paired runs compared the production build at `d700159` with the candidate that reuses the unpublished connection table between snapshot publications. Fresh Chromium 159.0.8154.6 profiles at 1280 × 720 and the pinned official sing-box 1.14.0/API 4 ran sequentially in baseline–candidate–candidate–baseline order. Each isolated loopback run opened and closed 10,200 flows, with at most 400 active at once. The test read Chromium DevTools performance counters during the workload. It then compared every one of the 10,000 retained records' keys, creation and close timestamps, and traffic totals with the independent native observer. All four runs matched, kept 50 mounted rows, used one browser Connections subscription, and sent no mutation RPC.

Median browser main-thread task time across the two runs per build went from 18.18 to 11.69 seconds. Median script time went from 4.14 to 3.88 seconds and style recalculation from 1.50 to 1.63 seconds. Tasks of at least 50 ms went from 9 to 3 in the first pair and from 7 to 0 in the second. Wall-clock durations stayed near 39 seconds under the fixed fixture cadence. Unforced heap samples varied by run. These results cover this bounded native history workload on the shared test host.

## Phase 5 — Sustained Runtime Monitor updates

At `1fd28e9`, a foreground Chromium 159.0.8154.6 context at 1280 × 720 with reduced motion ran the production build in explicit Demo mode at its default one-second interval. The shared Linux host exposed two CPUs. Seven checkpoints over 330.03 seconds stayed Live. The browser observed 330 distinct status receipt timestamps. Each of the six plotted series rendered 299 points at the final five-minute checkpoint. Switching to a one-minute window reduced each series to 60 points. Restoring five minutes returned each to 300 points.

Before switching windows, the browser observed 177 tasks of at least 50 ms, with a maximum of 113 ms. Chromium's coarse JS heap metric reported 23.4 MiB at each checkpoint. There were zero browser errors, failed requests or off-origin attempts. This single run measures foreground synthetic updates and chart bounds. Longer memory behavior, higher event rates and real-core performance remain separate checks.

### Continuous-series marker rendering

A follow-up compared `dfb3e14` and the chart marker change in alternating order, two runs per build. Source-mapped production builds used Chromium 159.0.8154.6, Playwright 1.65.1 and a 1280 × 720 foreground viewport on the shared two-CPU Linux host. Each fresh Demo context seeded the history with an accelerated clock, then resumed wall-clock speed for one-second updates and an 8.5-second CPU profile per window. Both builds showed the same four chart sizes and six series, and the status stream stayed Live. The measurements began with 300 points per series at five minutes and 60 at one minute.

Median sampled Recharts time including callees went from 1,234 to 724 ms at five minutes and from 647 to 538 ms at one minute. Its marker traversal accounted for 395 and 83 ms of baseline self time, respectively. No marker traversal time was sampled after the change. The normal production builds added 38 gzip bytes across JavaScript and CSS, including 30 in the Runtime Monitor chunk. This comparison measures continuous Demo data. The browser regression separately checks the marker and split segments around a gap. Real-core throughput and long-run memory remain separate checks.

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

### Collapsed outbound groups

Production builds used `834bdd3` as the baseline and deferred member filtering and rendering until a group was expanded in the candidate. The same explicit Demo fixture supplied 20 groups of 500 members. One Chromium 159.0.8154.6 browser at 1280 × 720 with reduced motion ran on a shared two-CPU Linux host. After one warm-up per build, three alternating pairs used fresh contexts. For each state, the settled sampling window lasted 2.66–2.74 seconds.

| Group state | Median main-thread task time before → after | Median sampled time with the Proxies chunk on stack before → after |
| --- | ---: | ---: |
| All collapsed | 502.0 → 150.9 ms | 113.4 → 5.2 ms |
| One expanded | 779.6 → 489.3 ms | 104.1 → 16.1 ms |

Across the three collapsed windows the baseline recorded 12 tasks of at least 50 ms, with a maximum of 168 ms. The candidate recorded zero. Both builds mounted zero member rows when collapsed and 500 when one group opened by keyboard. Closing it returned to zero, and an exact search showed one matching row after automatic expansion. These timings cover this synthetic group workload.

## Phase 5 — High-volume core log fixture

At `c08b35a`, two fresh Chromium 159.0.8154.6 contexts used the production app with explicit demo mode and synthetic ANSI messages at 1280 × 720. A 1,000-message reset retained all 1,000 messages. The 12,000-message case applied the same reset and eleven 1,000-message appends, checking the latest displayed sequence after each batch. It retained exactly the latest 2,000 messages. The adjacent evicted sequence was absent from search. Both cases mounted at most 200 rows, showed the expected bold styling and exported one searched latest row as plain text without ANSI escapes. There were no page errors or off-origin requests.

In the 12,000-message case, browser dispatch through visible assertions took 167–329 ms per append. The live measurement window contained four long tasks with a maximum of 95 ms. The JS heap sample was 24.1 MiB without forced collection. These are single synthetic runs.

### Native high-volume log delivery

At `f71339b`, Chromium 159.0.8154.6 (Playwright 1.65.1, 1280 × 720) loaded the production dashboard served by official sing-box 1.14.0/API 4 in a Linux loopback-only network namespace. The fixture opened and closed owned TCP connections in waves of eight. An independent native observer and the browser's decoded gRPC-Web response contained the same ordered live log sequence. The 200-connection checkpoint delivered 1,000 live records in 1.205 seconds. The 2,000-connection checkpoint delivered 10,000 in 11.493 seconds. Three initial reset-history records were counted separately.

The Logs view rendered 200 rows on its oldest and newest retained pages. Its complete plain-text export matched the latest 2,000 records from both observers and confirmed the adjacent eviction boundary. The export used browser receipt times. The browser used one HTTP 200 log subscription and made no mutation requests. With CDP response capture enabled, the 11.895-second delivery and quiet window recorded no tasks of at least 50 ms. This was one paced loopback run. Sustained logging and long-run memory behavior remain unmeasured by this fixture.

## Phase 5 — Local browser and HTTPS compatibility

CI runs Chromium on desktop and with a mobile device profile. These local desktop Linux smoke checks use production builds and Playwright 1.65.1. [CI browser configuration](../playwright.config.ts)

- At `bcb7ee85`, Firefox 159.0 (revision 1572) and WebKit 27.2 (revision 2388) each loaded 19 assets from a static `/preview/` mount and rendered 28 Connections rows after explicitly starting Demo. Reload preserved the route URL. Starting Demo again restored access to the route. Both engines also connected over cross-origin loopback HTTP to official sing-box 1.14.0. The core rejected an incorrect Bearer token and accepted the valid test token on API 4. Remember was off by default. Explicitly enabling it restored the Logs route after reload. The token was absent from localStorage and sessionStorage. Both engines recorded zero page errors and zero failed asset requests.
- At `16a4ac58`, the same Firefox build negotiated TLS 1.3 for `/preview/` and the separate API origin. Caddy 2.11.9 forwarded API calls to official sing-box 1.14.0 over loopback HTTP. CORS allowed the configured origin to send `Authorization` and the gRPC-Web headers, and omitted the allow-origin header for an unapproved origin. Authenticated `GetVersion` and `SubscribeStatus` each returned HTTP 200 over gRPC-Web. Runtime reported the status stream as Live and its last-received timestamp advanced on the next frame. The page reported zero runtime errors.
- At `845ce6c`, Chromium 159.0.8154.6 loaded `/dashboard/#/runtime-monitor` from official sing-box 1.14.0 through a disposable OpenSSH 10.0p2 loopback forward. It inferred the forwarded origin, the core rejected an incorrect Bearer, and valid credentials reached API 4. Runtime reported the service and status streams as Live, and the displayed last-received timestamp advanced. Reload preserved the route and cleared the unremembered token. The browser reported zero page errors and zero requests outside the forwarded origin. The forwarded HTML matched the production candidate byte for byte. The SSH server required the disposable public key, preserved pre-authentication isolation and permitted only the API forward. The client pinned the temporary host key. Closing SSH closed the forwarded listener while the loopback core remained reachable. Temporary credentials, server and browser processes, and listeners were cleaned up.

Firefox required an approved exception to the workspace execution sandbox to start its content processes. Firefox's own content sandbox and certificate validation remained enabled. The HTTPS test CA was trusted only in a disposable NSS profile. A fresh profile rejected both HTTPS origins with `SEC_ERROR_UNKNOWN_ISSUER`. Remote native API TLS deployments and physical mobile devices still need validation. The public Pages loopback test below covers Chromium's current permission behavior. [Browser security and deployment](api-compatibility.md#browser-security-and-deployment) · [Independent static hosting](deployment.md#b-independent-static-hosting)

### Web Locks and IndexedDB contention

At `ccb84bd`, fresh desktop Linux runs in Firefox 159.0 and WebKit 27.2 used Playwright 1.65.1 with the official sing-box 1.14.0/API 4 built-in loopback dashboard. One same-origin tab held the Web Lock while another attempted to restore a remembered connection. Each engine showed one held and one pending lock. The restoring tab made zero native requests during the 232 ms observation before release. After release, it restored the requested Runtime Monitor route and received fresh status data.

The opt-in IndexedDB record contained encrypted data and a nonextractable AES-GCM key. Web Storage contained no plaintext token. **Disconnect** removed the record. A fresh tab then showed an empty token field and made zero native requests during the observation. These checks cover restore and disconnect in the tested desktop engines.

### Official sing-box 1.14.5 built-in dashboard

At `dfb3e14`, Chromium 159.0.8154.6 opened the production build from the built-in `/dashboard/` of official sing-box 1.14.5 Linux amd64 (revision `a6844a780`). The 38 production files matched the merged build, and the core served the expected HTML byte for byte. The app inferred the loopback API origin, accepted the disposable Bearer on API 4, showed the Running service, and received two successive Runtime Monitor status frames. It displayed the configured selector and its selected and alternate nodes. Settings displayed the configured dynamic USB/IP service with zero devices and canceled that subscription on route exit.

The five observed native gRPC-Web methods returned HTTP 200. The browser reported zero page errors and zero off-origin requests. This loopback smoke covers the listed paths on 1.14.5. The pinned integration baseline remains 1.14.0. [Official 1.14.5 release](https://github.com/SagerNet/sing-box/releases/tag/v1.14.5)

### Nginx streaming and reconnect

At `88cf309`, Firefox 159.0 opened the production `/preview/` mount over TLS 1.3 through Debian Nginx 1.26.3 (`1.26.3-3+deb13u11`). Nginx forwarded same-origin requests to official sing-box 1.14.0 over loopback. The browser trusted a disposable CA only in its temporary profile and verified the server certificate. It authenticated against API 4 and received three successive runtime frames on one stream. Stopping the core interrupted the stream. After restart, the app ran another version check, returned to Connected and Live, and received two successive frames on a second HTTP 200 gRPC-Web subscription. The browser recorded zero page errors or off-origin requests.

In a separate authenticated gRPC-Web probe against the same proxy and core, `proxy_buffering off` delivered four frames within 3.5 seconds. With response buffering enabled, the connection opened and stayed open without delivering headers or frames during that window. This comparison used one loopback Nginx configuration and a one-second status interval. [Nginx response buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)

### Published GitHub Pages baseline

Chromium 159.0.8154.6 loaded the public `/SingDeck/` mount with browser certificate validation and TLS 1.3. The browser's 15 distinct HTML and asset responses matched the published `v0.8.1` ZIP byte for byte. Explicit Demo reached Connections, and reloading `/SingDeck/#/connections` kept the hash in the address bar while returning to the entry screen. Choosing Demo again opened Overview as configured in `v0.8.1`. No page errors, failed requests or off-origin requests were observed. The Pages deployment run succeeded for `v0.8.1` (`dfb16e8`), and the `v0.9.0-pre.1` run published the archive with the deploy job skipped. The next check covers browser permission for a loopback native API from this deployed baseline. [Public dashboard](https://knowsky404.github.io/SingDeck/) · [Stable deployment](https://github.com/KnowSky404/SingDeck/actions/runs/45726481221) · [PRE archive run](https://github.com/KnowSky404/SingDeck/actions/runs/45956326830)

### Public Pages to a loopback native API

Full headless Chromium 159.0.8154.6 loaded the actual `v0.8.1` Pages mount over TLS 1.3. Each of three fresh cases received the verified release HTML. A disposable official sing-box 1.14.0 listener used loopback HTTP and allowed CORS only for the Pages origin. Web security and certificate validation used stock settings. The temporary root fixture disabled Chromium's Linux process sandbox.

With the loopback permission left at its default prompt state in headless Chromium, and with an explicit per-origin denial in a second case, the ordinary CORS preflight returned HTTP 204. Chromium blocked the subsequent `GetVersion` POST with `LocalNetworkAccessPermissionDenied`, and the app could not verify the core. An explicit per-origin loopback grant in a third case let the core reject an incorrect Bearer with gRPC code 16 and accept the correct Bearer on API 4. The app reached Connected, rendered a numeric memory reading, and received three data events on an HTTP 200 native status subscription.

The grant case also emitted DevTools permission audit entries for RPCs that completed successfully at the network and app levels. No requests outside the two test origins or browser page errors were observed. None of the cases used legacy PNA preflight headers.

Two fresh headed Chromium 159.0.8154.6 Linux profiles also received the verified `v0.8.1` Pages HTML over TLS 1.3 and showed the browser's **Access other apps and services on this device** prompt. Selecting **Allow** verified the loopback official sing-box 1.14.0 on API 4, connected and received three native status data events. Selecting **Block** in the other profile left the app unable to verify the core. The CORS preflight returned HTTP 204, but Chromium reported `LocalNetworkAccessPermissionDenied` for the `GetVersion` POST. Both profiles used standard web security and certificate validation. These observations cover the published stable build and desktop loopback. The current candidate, LAN addresses and mobile browsers still need separate verification. [Public dashboard](https://knowsky404.github.io/SingDeck/) · [Chrome Local Network Access guide](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)

### Clipboard permissions

At `88cf309`, isolated Chromium 159.0.8154.6 contexts opened the production build over loopback. With clipboard permissions granted, **Copy domain** in the Demo Connection Inspector wrote the exact fixture value to the browser clipboard. A fresh context served `Permissions-Policy: clipboard-write=()`. Chromium reported the permission as denied, the inspector showed **Clipboard unavailable**, and the Connections JSON export still downloaded all 28 demo records. This check used the browser's Clipboard API and synthetic Demo data.

### Content Security Policy smoke

At `f28375e`, Chromium 159.0.8154.6 loaded the production app from static `/preview/` with a test response header using `default-src 'none'`, same-origin scripts, styles, images and fonts, and `connect-src` limited to the exact loopback API origin. The app connected to official sing-box 1.14.0 on API 4, rendered the runtime charts and reported a Live status stream with no browser errors or policy violations. A separate loopback destination was blocked by `connect-src` before its listener received a request. This check covers the Runtime Monitor path with a host-managed header. [CSP connect-src](https://www.w3.org/TR/CSP3/#directive-connect-src)

### Installability research

At `88cf309`, Chromium 159.0.8154.6 ran a disposable manifest prototype alongside the unmodified production build on loopback. Relative `start_url` and `scope`, the default start URL as app ID, and local 192px and 512px icons yielded separate launch identities under `/dashboard/` and `/preview/`. The regular temporary profile reported `no-manifest` for the baseline and zero Chromium installability diagnostics for the prototype at `/preview/`. All four mount and variant combinations loaded scoped resources and preserved the Connections hash on reload. The prototype loaded under `manifest-src 'self'`. A `manifest-src 'none'` control blocked the manifest before a request. No Service Worker registrations or CacheStorage entries were observed. [Web App Manifest identity](https://www.w3.org/TR/appmanifest/#id-member) · [Chrome installation criteria](https://developer.chrome.com/blog/update-install-criteria)

A follow-up reused the `88cf309` `/preview/` prototype in headed Chromium 159.0.8154.6 under Xvfb, with a disposable Linux profile and isolated desktop directories. Chromium's DevTools PWA commands registered the exact `/preview/` app identity and created a Linux desktop shortcut. An explicit launch outside the registered scope was rejected. After selecting standalone display mode through DevTools, the manifest start URL opened in a separate Chromium window and matched the standalone display-mode query. Uninstall removed the identity and shortcut, and a subsequent launch was rejected.

The experiment used the browser's install, launch and uninstall commands with a prototype manifest. It observed no service worker, CacheStorage entries, external requests or page errors. The interactive production-build check is recorded below. [DevTools PWA commands](https://chromedevtools.github.io/devtools-protocol/tot/PWA/)

The installable production candidate includes `manifest.json` and two PNGs derived from the unchanged project favicon. Compared with `269e6ff`, only `index.html` changed among the 38 existing output files. Headed Chromium 159.0.8154.6 under Xvfb parsed distinct identities and launch paths for `/` and `/preview/` in one disposable profile. Both PNG sizes decoded. DevTools installed both apps, and after setting standalone mode they opened separate windows at their own start URLs. The `/preview/` app rejected a launch outside its scope. Uninstall removed each registration and desktop shortcut without removing the other app. No service worker or CacheStorage entries were observed on the pages or after launch.

Chromium desktop and emulated mobile tests verify the production manifest, including its mount-relative icon URLs and the absence of application caches and service-worker registrations after opening Demo. The Playwright Pixel 7 profile also parsed the correct manifest and decoded both sizes at both mounts.

The 41-file production build for `0dfedf6` passed interactive installation in Chromium 159.0.8154.6 at the loopback `/preview/` mount. In a disposable Linux profile under Xvfb, Chromium's address-bar **Install** control opened the native prompt. After confirmation, **Open tab in app** opened SingDeck in a separate standalone window. The manifest identity, start URL and scope all resolved to `/preview/`. **Explore demo** opened Overview in Mock mode. The page reported zero service-worker registrations and CacheStorage entries. Confirming **Uninstall** from the app title bar closed the window. Desktop launcher and physical mobile installation remain separate checks.

Official sing-box 1.14.0 downloaded a root-layout ZIP over loopback and extracted all 41 files from the candidate byte for byte. The core redirected `/dashboard` to `/dashboard/` and served the manifest as `application/json` and both icons as `image/png`. A fresh regular Chromium profile parsed the built-in mount as the manifest identity, scope and start URL with zero installation diagnostics. The browser authenticated on API 4, observed live service and runtime streams, and received three data events on the native status stream. Reload kept the route and showed the unremembered entry form with an empty Bearer field. The profile had no service worker or CacheStorage entries.

On the same candidate, Firefox 159.0 and WebKit 27.2 opened explicit Demo at `/preview/` and rendered all 28 Connections rows under both CSP controls. With `manifest-src 'self'`, WebKit sent a native manifest request and received HTTP 200. With `manifest-src 'none'`, it produced a policy violation before sending the request. Firefox resolved the same-origin manifest link and made no manifest request in either desktop run.

Runtime Monitor and the Overview Traffic activity chart offer 1, 3 and 5 minute history windows for the current visit. Both start with the configured profile window. The existing hash route determines the initial page, with Overview as the default. Runtime history is bounded and held in the active session. Distinct manifest identities on one origin still share that origin's storage boundary. [Runtime Monitor](../src/features/dashboard/runtime-monitor.tsx) · [Overview](../src/features/dashboard/page.tsx) · [Architecture](architecture.md)

### Overview card layout

Customize Overview reorders the four metric cards and four detail panels in their respective groups. Detail panels can move between rows. Changes apply immediately and follow the browser origin. Reset layout restores the original order. The preference stores the card IDs. An unreadable or invalid preference uses the original order, and a write failure leaves the selected layout usable while this Overview is open.

Chromium desktop and 320px emulated mobile verified visual and keyboard order, focus, reload, reset and a 250px-tall scrollable settings dialog. The chart continued rendering its selected history window after moving between panel slots. A Chromium session on the official sing-box 1.14.0 built-in dashboard measured real traffic before and after the reorder using the same status subscription. It restored the layout after a reload and new login.

### Overview traffic history window

In a production Chromium 159.0.8154.6 browser, official sing-box 1.14.0/API 4 served the built-in dashboard and reported traffic from one isolated QA connection. Overview showed a nonzero chart while the browser switched through the 1-, 3- and 5-minute views. Later status updates and the confirmed connection close kept the 5-minute selection. The browser used one native status subscription throughout. This check used the stock one-minute profile default.

Chromium desktop and 320px emulated mobile also exercised explicit Demo in the production build. Each series rendered 59–60, 179–180 and 299–300 samples as the selected interval widened. Keyboard and touch controls stayed within the viewport. Live updates kept the selected window, a later visit restored the default, and widening an empty view after more than five minutes kept expired samples hidden. The Runtime Monitor chart and keyboard regressions passed on the same build.

### Credential handling and dependency audit

- At `f17c32c`, a production Chromium session used the built-in dashboard on official sing-box 1.14.0. A synthetic 401 for the USB/IP subscription displayed an error in that view. The real `GetVersion` accepted the same Bearer and the saved connection restored after reload. The same browser flow confirmed that a primary 401 revokes the saved credential and a primary 403 preserves it. The session tests cover confirmation coalescing, cancellation and outdated responses. [Authentication verification](https://github.com/KnowSky404/SingDeck/pull/40)
- The native core version, Notifications and USB/IP label regressions cover reflection of the active credential in untrusted text, including cases where rendered whitespace would reveal it. Browser checks exercised the displayed core version, diagnostics exports and the relevant native and demo status views. [Version redaction](https://github.com/KnowSky404/SingDeck/pull/34) · [Shared native text projection](https://github.com/KnowSky404/SingDeck/pull/37)
- A 2026-11-27 Bun audit found a moderate advisory in the development-only shadcn CLI dependency graph. At `f28375e`, the updated graph resolved minimatch 11.0.9. Both production and full dependency audits returned empty advisory sets. The regenerated notices and all 38 production files matched the prior build. [Dependency audit and remediation](https://github.com/KnowSky404/SingDeck/pull/36)

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
