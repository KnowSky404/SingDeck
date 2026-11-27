# Native API capability matrix

SingDeck v0.8.1 audit baseline: commit `dfb16e8`. The vendored `daemon.StartedService` defines **42 RPCs**: 22 unary, 17 server streaming and 3 bidirectional streaming. The generated descriptor exposes all 42. The typed `SingBoxClient` supports 14, with 12 consumed by the workspace and two Clash Mode methods exposed only in the SDK at this baseline. Phase 1 extends the typed client to **18** methods with four new workspace integrations. [Vendored proto](../proto/daemon/started_service.proto) · [SDK](../src/api/client.ts)

## Contract and evidence

- The matrix uses **core v1.14.0 / API 4** as its common compatibility baseline. API version 4 and the byte-identical schema were also confirmed in the stable v1.14.5 and v1.15.0-alpha.14 sources on 2026-11-27. The release and source comparisons establish wire compatibility. The runtime gate and real-core tests determine SingDeck support. Per-RPC minimum revisions before this baseline remain unverified. [Pinned proto](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/started_service.proto) · [Pinned implementation](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/started_service.go) · [Upstream releases](https://github.com/SagerNet/sing-box/releases)
- **U** is unary, **S** is server streaming and **B** is bidirectional streaming. The schema has no client-only streaming RPC. `Empty` is `google.protobuf.Empty`. All rows require a reachable native API service and the configured Bearer secret when one is set. The dependency column lists additional core or configuration requirements. [API service](https://sing-box.sagernet.org/configuration/service/api/) · [Core auth interceptors](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/server.go)
- **HTTP** is binary gRPC-Web via the current browser fetch adapter. **WS** is the upstream `grpc-websockets` bridge. WS rows are blocked in SingDeck pending a verified adapter and feature-specific validation. [HTTP bridge](https://github.com/SagerNet/sing-box/blob/v1.14.0/service/api/web_bridge.go) · [WS bridge](https://github.com/SagerNet/sing-box/blob/v1.14.0/service/api/web_bridge_websocket.go) · [Official dashboard transport](https://github.com/SagerNet/sing-box-dashboard/tree/3e4bf08e5bf5b9417cf9c36e5a2d5abcb21bdd34/src/api)
- **Verified** denotes a checked contract behavior in the official v1.14.0 fixture. **Absent only** means the fixture tested the unavailable branch. **Call only** means the RPC was exercised without an independent effect assertion. **Transport only** means a browser-to-core stream was exercised without a working service or device fixture. **—** means no recorded real-core test. See the verification record for mock coverage, fixtures and deployment limits. [Integration tests](../tests/native.integration.test.ts) · [Diagnostics integration tests](../tests/diagnostics.integration.test.ts) · [Verification](verification.md)
- **Base** means existing workspace behavior. The numbered phases track expansion in the [roadmap](roadmap.md).

## Runtime and diagnostics

| RPC | Request → response | Kind | SDK | UI | Core dependency and known limits | Browser | Real core | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GetVersion | Empty → Version | U | Yes | Connect, Overview | Reports core version and coarse API revision. | HTTP | Verified | Base |
| SubscribeServiceStatus | Empty → ServiceStatus | S | Yes | Workspace status | Event stream. The attached HTTP service starts in STARTED. | HTTP | Verified | Base / 2 |
| SubscribeStatus | SubscribeStatusRequest → Status | S | Yes | Overview | Nanosecond interval, default 1 s. Traffic totals and inbound counts depend on a traffic manager. | HTTP | Verified | Base / 2 |
| GetStartedAt | Empty → StartedAt | U | Yes | Overview uptime | Unix milliseconds. Attached service records its start at attachment. | HTTP | Verified | Base / 2 |
| GetDeprecatedWarnings | Empty → DeprecatedWarnings | U | Yes | Configuration Health | Needs the daemon's warning collector for nonempty results. The built-in API attaches to the box context and may return an empty list without a collector. Reads drain a present collector. | HTTP | CLI empty and SFL managed warning verified | 1 |
| StartNetworkQualityTest | NetworkQualityTestRequest → NetworkQualityTestProgress | S | Yes | Diagnostics | Selected or default outbound must reach the configured measurement service. HTTP/3 needs a QUIC build and a usable UDP path. Inspect final message and stream status. | HTTP | Controlled HTTP and cancellation | 1 |
| StartSTUNTest | STUNTestRequest → STUNTestProgress | S | Yes | Diagnostics | Selected or default outbound needs UDP. NAT behavior needs suitable RFC 5780 server support. v1.14.0 direct IPv4 literals can fail where a DNS-resolved target works. Inspect final message and stream status. | HTTP | Controlled UDP binding | 1 |

## Outbounds, modes, connections and logs

| RPC | Request → response | Kind | SDK | UI | Core dependency and known limits | Browser | Real core | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SubscribeGroups | Empty → Groups | S | Yes | Outbounds groups | Configured groups and shared URL-test history. Snapshots report direct membership and selection. | HTTP | Verified | Base / 1 |
| SubscribeOutbounds | Empty → OutboundList | S | Yes | All outbounds | Outbounds and endpoints share one list of tag, type and URL-test history. The wire item has no endpoint flag. Duplicate tags are ambiguous for tag-only operations. | HTTP | Verified | 1 |
| URLTest | URLTestRequest → Empty | U | Yes | Group and node tests | Resolves a tag through the outbound manager. Acknowledges scheduling. Core context owns the probe. History is asynchronous, shared by resolved tag and deleted on failure. | HTTP | Verified | Base / 1 |
| SelectOutbound | SelectOutboundRequest → Empty | U | Yes | Selector control | Requires a selector and member. Observe the group snapshot for selection confirmation. | HTTP | Verified | Base / 1 |
| SetGroupExpand | SetGroupExpandRequest → Empty | U | — | — | Persists when the core has a cache file. Otherwise returns success without storing expansion. Later group snapshots may report the cached flag. | HTTP | — | 2 evaluated in source |
| GetClashModeStatus | Empty → ClashModeStatus | U | Yes | — | Requires the core Clash mode manager, typically a `with_clash_api` build and `experimental.clash_api`. Returns NotFound if absent. | HTTP | Absent only | 2 |
| SubscribeClashMode | Empty → ClashMode | S | — | — | Same mode manager, with initial and change events. At a stopped lifecycle state the mode can be empty. | HTTP | — | 2 |
| SetClashMode | ClashMode → Empty | U | Yes | — | Same mode manager. The core ignores unknown modes and still acknowledges the RPC. Use reported names and confirm through live state. | HTTP | Absent only | 2 |
| SubscribeConnections | SubscribeConnectionsRequest → ConnectionEvents | S | Yes | Connections | Traffic manager required. The native API service enables tracking. Initial reset snapshot and interval deltas use different counter semantics. | HTTP | Verified | Base / 2 |
| CloseConnection | CloseConnectionRequest → Empty | U | Yes | Close row | Requires traffic manager. A missing ID can return success. Observe the stream before confirming a row closed. | HTTP | Verified with close-all call | Base / 2 |
| CloseAllConnections | Empty → Empty | U | Yes | Confirm close all | Closes managed connections and tracked flows where managers exist. Empty success carries no affected count. | HTTP | Call only | Base / 2 |
| SubscribeLog | Empty → Log | S | Yes | Logs | Initial/replacement history can carry reset. Log records carry no server timestamp. | HTTP | Verified | Base / 2 |
| GetDefaultLogLevel | Empty → DefaultLogLevel | U | Yes | Logs | Requires an instance log factory. Reports core default. | HTTP | Verified | Base |
| ClearLogs | Empty → Empty | U | Yes | Confirm core buffer clear | Clears shared in-memory history and notifies active subscribers with a reset. The browser clear is independent. | HTTP | Verified | 2 |
| SubscribeNotifications | Empty → NotificationEvent | S | — | — | Requires events emitted into the daemon observer. No replay or liveness heartbeat. Carries send and cancel variants. | HTTP | — | 2 |

## Native services

| RPC | Request → response | Kind | SDK | UI | Core dependency and known limits | Browser | Real core | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SubscribeTailscaleStatus | Empty → TailscaleStatusUpdate | S | — | — | `with_tailscale` and a configured Tailscale endpoint. An unconfigured instance can emit an empty list. | HTTP | — | 4 |
| StartTailscalePing | TailscalePingRequest → TailscalePingResponse | S | — | — | Tailscale endpoint and peer. Results can carry errors and direct, relay or DERP information. | HTTP | — | 4 |
| SetTailscaleExitNode | SetTailscaleExitNodeRequest → Empty | U | — | — | Tailscale endpoint and valid exit-node selection. Confirm effect in status. | HTTP | — | 4 |
| TailscaleLogout | TailscaleLogoutRequest → Empty | U | — | — | Configured Tailscale endpoint. Changes login state. | HTTP | — | 4 evaluation |
| GetTailscaleCertificate | TailscaleCertificateRequest → TailscaleCertificate | U | — | — | Configured Tailscale endpoint and certificate eligibility. Response contains private key material. | HTTP | — | 4 evaluation |
| StartTailscaleSSHSession | TailscaleSSHClientMessage → TailscaleSSHServerMessage | B | — | — | Tailscale endpoint and reachable SSH service. Authentication, trust and stream lifecycle need a dedicated fixture. | WS blocked | — | 4 research |
| SubscribeTaildropInbox | SubscribeTaildropInboxRequest → TaildropInbox | S | — | — | Tailscale endpoint and Taildrop. An absent endpoint can yield an empty inbox. | HTTP | — | 4 |
| MarkTaildropInboxRead | MarkTaildropInboxReadRequest → Empty | U | — | — | Tailscale endpoint and Taildrop. Alters inbox read state. | HTTP | — | 4 |
| SendTaildropFiles | TaildropSendClientMessage → TaildropSendServerMessage | B | — | — | Tailscale endpoint and recipient. Core expects start metadata followed by chunks and validates each declared length. | WS blocked | — | 4 research |
| DownloadTaildropFile | DownloadTaildropFileRequest → DownloadTaildropFileChunk | S | — | — | Tailscale endpoint and existing file. Browser needs a bounded path from chunks to storage. | HTTP | — | 4 |
| DeleteTaildropFile | DeleteTaildropFileRequest → Empty | U | — | — | Tailscale endpoint and existing file. Deletes inbox contents. | HTTP | — | 4 |
| CancelTaildropReceiving | CancelTaildropReceivingRequest → Empty | U | — | — | Tailscale endpoint and an active transfer. | HTTP | — | 4 |
| SubscribeOpenConnectStatus | Empty → OpenConnectStatusUpdate | S | — | — | `with_openconnect` and an OpenConnect endpoint. Includes tunnel status and form or browser challenge details. | HTTP | — | 4 |
| SubmitOpenConnectAuthResponse | OpenConnectAuthResponseSubmission → Empty | U | — | — | Current challenge and matching form or browser response. Browser variant can require cross-origin cookies or headers unavailable to the dashboard. | HTTP, browser auth unverified | — | 4 |
| CancelOpenConnectAuthChallenge | OpenConnectAuthChallengeCancel → Empty | U | — | — | Configured endpoint and current challenge ID. | HTTP | — | 4 |
| SubscribeOpenVPNStatus | Empty → OpenVPNStatusUpdate | S | — | — | `with_openvpn` and an OpenVPN client endpoint. Reports tunnel and challenge state. | HTTP | — | 4 |
| SubmitOpenVPNChallengeResponse | OpenVPNChallengeSubmission → Empty | U | — | — | Current OpenVPN challenge. Response can contain username, password or secret. | HTTP | — | 4 |
| CancelOpenVPNChallenge | OpenVPNChallengeCancel → Empty | U | — | — | Configured client endpoint and current challenge ID. | HTTP | — | 4 |
| SubscribeUSBIPServerStatus | Empty → USBIPServerStatusUpdate | S | — | — | `with_usbip` on Linux, Windows or macOS with cgo, and a dynamic USB/IP service. Build stub returns NotFound. | HTTP | — | 4 |
| ProvideUSBDevices | USBProviderMessage → USBServerMessage | B | — | — | Supported USB/IP build, dynamic service and browser/device permissions. Build stub returns Unimplemented. | WS blocked | Transport only | 4 research |

Build-tag and implementation references: [Clash build tag](https://github.com/SagerNet/sing-box/blob/v1.14.0/include/clashapi.go) · [Clash mode behavior](https://github.com/SagerNet/sing-box/blob/v1.14.0/experimental/clashapi/server.go#L222-L250) · [Tailscale](https://github.com/SagerNet/sing-box/blob/v1.14.0/include/tailscale.go) · [Taildrop](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/started_service_taildrop.go) · [OpenConnect](https://github.com/SagerNet/sing-box/blob/v1.14.0/include/openconnect.go) · [OpenVPN](https://github.com/SagerNet/sing-box/blob/v1.14.0/include/openvpn.go) · [USB/IP](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/started_service_usbip.go) · [USB/IP build stub](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/started_service_usbip_stub.go)

## Browser bidirectional transport

The v1.14.0 bridge uses one WebSocket per RPC. Its first binary client message carries RPC metadata, including Bearer authentication when configured. Subsequent binary messages prefix body data with byte 0, and byte 1 alone half-closes the request. The server sends gRPC-Web metadata, data and trailers. The bridge has a 4 MiB incoming WebSocket message limit and sends a ping every 30 seconds. The upgrade skips the server WebSocket library's Origin verification. A deployment needs a separately verified WS Origin policy where required. The browser's TLS trust rules still apply. [Pinned WebSocket implementation](https://github.com/SagerNet/sing-box/blob/v1.14.0/service/api/web_bridge_websocket.go)

A temporary Chromium fixture against the official v1.14.0 core verified the WebSocket handshake, Bearer rejection without credentials, two interleaved protobuf replies for an absent USB/IP service, half-close and status trailers. The core accepted an Origin outside the configured HTTP CORS allowlist. Hardware and cross-deployment WS behavior remain unverified.

Before enabling WS features, verify browser and proxy upgrade, framed Protobuf and metadata, bounded send and receive buffers, deadlines, cancellation, half-close and trailer error handling with a real core. Validate Taildrop against controlled transfers, SSH against a controlled peer, and USB/IP against permitted hardware or a supported fixture. Record a feature as blocked if these conditions cannot be verified.
