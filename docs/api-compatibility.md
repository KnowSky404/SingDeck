# Native API compatibility

Research baseline: **sing-box v1.14.0**, commit `0b8995879f29a9b98ee027bc17b75e101445b238`.
The dashboard uses an independent UI. The upstream dashboard was consulted for protocol behavior.

## Authoritative sources

- [Service API documentation](https://sing-box.sagernet.org/configuration/service/api/)
- [Pinned Protobuf](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/started_service.proto)
- [Pinned implementation](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/started_service.go)
- [HTTP bridge and CORS](https://github.com/SagerNet/sing-box/blob/v1.14.0/service/api/web_bridge.go)
- [WebSocket bridge](https://github.com/SagerNet/sing-box/blob/v1.14.0/service/api/web_bridge_websocket.go)
- [Network quality implementation](https://github.com/SagerNet/sing-box/blob/v1.14.0/common/networkquality/networkquality.go)
- [STUN implementation](https://github.com/SagerNet/sing-box/blob/v1.14.0/common/stun/stun.go)
- [RPC inventory and verification matrix](native-api-capabilities.md)
- [Dashboard hosting](https://github.com/SagerNet/sing-box/blob/v1.14.0/service/api/dashboard.go)
- [Official dashboard transport reference](https://github.com/SagerNet/sing-box-dashboard/tree/main/src/api)

## Wire contract

Service: `daemon.StartedService`; POST `/<service>/<RPC>`. Native HTTP/2 gRPC and HTTP gRPC-Web binary/text are accepted. The bridge flushes streaming responses and embeds trailers in gRPC-Web frames. Connect **protocol** is not accepted: use ConnectRPC's `createGrpcWebTransport`, binary Protobuf and browser fetch readable streams. No WebSocket adapter is needed for the unary/server streams in P0. The official core also serves the `grpc-websockets` protocol. A loopback Chromium proof exercised authenticated bidirectional framing and client half-close. SingDeck currently uses fetch gRPC-Web. TLS trust, Origin enforcement, flow control and each feature's lifecycle need independent validation before adding a WebSocket client.

Metadata: `authorization: Bearer <secret>`. No query credentials. Unary deadline 10s; subscription scope cancellation; status watchdog; bounded exponential reconnect for transient failures. Authentication, permission, unsupported API and malformed requests require correction, not an insecure retry/fallback.

`GetVersion` returns core `version` and integer `apiVersion`; **v1.14.0 uses API version 4**, not 1. SingDeck gates on API 4 and core >=1.14.0 stable; other API revisions fail explicitly until verified. The vendored proto and API 4 are unchanged in the v1.14.5 stable and v1.15.0-alpha.14 sources. Stable v1.14.5 received a targeted STUN runtime check. Prereleases remain outside SingDeck's connection gate. [Upstream releases](https://github.com/SagerNet/sing-box/releases)

| RPC | Input | Output / semantics |
| --- | --- | --- |
| GetVersion | Empty | Version: version, apiVersion |
| SubscribeServiceStatus | Empty | stream ServiceStatus; IDLE/STARTING/STARTED/STOPPING/FATAL, errorMessage |
| SubscribeStatus | interval int64 **nanoseconds** | stream Status; memory bytes, connectionsIn/Out, trafficAvailable, interval byte deltas uplink/downlink, cumulative totals |
| SubscribeGroups | Empty | stream Groups.group[]; tag/type/selectable/selected/items |
| SubscribeOutbounds | Empty | stream OutboundList.outbounds[]; tag, type, URL-test timestamp/delay. Endpoint and outbound records share the same shape. |
| GetDeprecatedWarnings | Empty | DeprecatedWarnings.warnings[]; message, description, impending, deprecatedVersion, scheduledVersion, migrationLink |
| StartNetworkQualityTest | configURL, outboundTag, serial, maxRuntimeSeconds, http3 | stream NetworkQualityTestProgress. Capacity in bit/s, response count per minute, idle latency and elapsed time in milliseconds. |
| StartSTUNTest | server, outboundTag | stream STUNTestProgress. Binding address, latency in milliseconds, NAT mapping and filtering, NAT support flag, final state. |
| SelectOutbound | groupTag, outboundTag | Empty; await server response and groups subscription for selection |
| URLTest | outboundTag | Empty; observed results arrive through groups and the inventory subscription |
| SubscribeLog | Empty | stream Log.messages[] (level/message), reset flag; no server timestamp |
| GetDefaultLogLevel | Empty | DefaultLogLevel.level |
| SubscribeConnections | interval int64 nanoseconds | stream ConnectionEvents (reset + NEW/UPDATE/CLOSED); UPDATE deltas increment totals, CLOSED stores final counters/closedAt; Active/Closed filters use the timestamp |
| CloseConnection | id | Empty; closed state confirmed by stream |
| CloseAllConnections | Empty | Empty; destructive action requires confirmation |
| GetClashModeStatus | Empty | modeList/currentMode, NotFound if mode manager absent |
| SetClashMode | mode (field 3) | Empty; SDK only in P0 |
| GetStartedAt | Empty | startedAt Unix **milliseconds**, used for uptime |

Status rates divide the native byte deltas by the requested interval in seconds. The initial sample, gaps, and counter resets leave the rate unavailable. Status frames carry no timestamps. Runtime Monitor uses browser receipt time for its observed history. Inbound counts and cumulative traffic require the core's traffic manager. The outbound count comes from the separate connection manager and is available on a running service even when traffic tracking is disabled. Memory is the process measurement exposed by the core's platform implementation. Zero memory is shown as unavailable. `GetStartedAt` measures service start time and can change after a reload in the same process. [Pinned status implementation](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/started_service.go#L463-L511) · [Core attachment](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/attached_service.go)

Group `urlTestTime` is Unix **seconds**, with 0 meaning no history. Failed tests delete history, so a missing measurement can indicate an untested or failed probe. A zero delay with a valid timestamp can represent a truncated sub-millisecond result. Negative delays are invalid. Log receipt times are local.

Connection `chainList` runs from the resolved outbound back through its selecting groups. Connection Inspector reverses the reported list for display. The native `outbound` and `outboundType` identify the resolved outbound, while `fromOutbound` comes from the original connection metadata. The chain describes selection. It omits transport detours. The rule contains the matched predicate when supplied. Connection creation and close times are Unix milliseconds. Process information and other absent fields are shown as unavailable. [Pinned tracker](https://github.com/SagerNet/sing-box/blob/v1.14.0/common/trafficcontrol/tracker.go#L67-L104) · [Connection encoding](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/started_service.go#L1043-L1080)

The inspector displays per-connection UPDATE byte deltas and keeps cumulative totals separate. The first update may cover part of a polling interval, and a frame carries no elapsed duration. A reset snapshot supplies cumulative counters. An all-zero UPDATE can be an idle marker or a counter reset, so zero-only fields do not establish an interval measurement.

The connection JSON download includes the retained records that match the current filters across all pages. It annotates retention truncation and preserves exact counters and timestamps as decimal strings. Native text fields go through the inspector's redaction. The file can contain network and process metadata.

The v1.14.0 log stream carries only level and text. Its optional rendered context ID differs from the connection UUID, so the workspace cannot reliably join logs to connections. [Log context ID](https://github.com/SagerNet/sing-box/blob/v1.14.0/log/id.go) · [Connection tracker](https://github.com/SagerNet/sing-box/blob/v1.14.0/common/trafficcontrol/tracker.go)

## Native diagnostic semantics

- Both diagnostic RPCs use the core's configured outbound when the tag is empty. A missing selected outbound can yield `NotFound` before a test runs. Both report execution failures inside an `isFinal` message, even when the RPC trailers are OK. SingDeck requires a final done message with an empty error and a clean stream end. It treats cancellation and interruption as incomplete.
- Network quality defaults to Apple's measurement configuration and a 20-second measurement budget. Configuration fetch and idle probing can extend wall-clock duration. The core accepts an explicit HTTP(S) URL or a bare host for `/.well-known/nq`. The core can follow redirects and configuration-defined measurement/dial targets. SingDeck requires explicit custom-target confirmation and bounds the measurement budget at 1–120 seconds. HTTP/3 additionally needs a QUIC build, an appropriate measurement service and a usable UDP path.
- Network quality phase codes are Idle 0, Download 1, Upload 2 and Done 3. Confidence codes are Low 0, Medium 1 and High 2, independently reported for both capacities and both RPM values. In parallel mode each direction supplies its own live values because the opposite direction in a frame can carry an older snapshot. The terminal result provides both directions and omits elapsed time, so SingDeck retains the reported measurement time. [Parallel measurement](https://github.com/SagerNet/sing-box/blob/v1.14.0/common/networkquality/networkquality.go#L743-L843)
- STUN defaults to `stun.voipgate.com:3478`. The phase codes are Binding 0, Mapping 1, Filtering 2 and Done 3. Mapping codes are Unknown 0, reserved 1, Endpoint-independent 2, Address-dependent 3 and Address and port-dependent 4. Filtering codes are Unknown 0, Endpoint-independent 1, Address-dependent 2 and Address and port-dependent 3. A binding can report an external address without supporting RFC 5780 NAT behavior discovery. A successful binding establishes the tested path only.
- The RPC identifies a missing tag with `NotFound`. Core-side execution failures share a single unstructured final error field, and inventory rows expose no UDP capability flag. Check the core logs to distinguish a route without UDP support from a timeout. SingDeck excludes raw error details. [STUN RPC](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/started_service.go#L1529-L1562)
- The pinned v1.14.0 core can fail direct STUN to an IPv4 literal with a native UDP address error. A hostname resolved by the core worked in the same fixture. v1.14.5 passed the literal-address fixture after the upstream change. [Pinned STUN](https://github.com/SagerNet/sing-box/blob/v1.14.0/common/stun/stun.go) · [Stable STUN](https://github.com/SagerNet/sing-box/blob/v1.14.5/common/stun/stun.go)
- The stock CLI's attached API may return an empty deprecation list because the context lacks the daemon's collector. Daemon collection is drained by reads. SingDeck retains reported warnings for a confirmed core lifecycle and displays an empty result as no warnings reported. Live monitoring can resume while the optional start timestamp retries. If two timestamp checks fail, SingDeck archives the prior warnings while it reads fresh reports. A match with the last confirmed timestamp restores archived reports. Reports from before a lifecycle gap are discarded if no previous timestamp can confirm their boot. A confirmed restart refreshes live data and retains fresh reports collected while the lifecycle stream remained connected. Run `sing-box check` or inspect the core logs for configuration validation. [Warning collector](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/deprecated.go)

## Browser security and deployment

Server CORS allows POST/GET/OPTIONS and Content-Type, Authorization, X-Grpc-Web, X-User-Agent, Grpc-Timeout; exposes gRPC status headers. Set explicit trusted origins (the upstream empty-list default is `*`). `access_control_allow_private_network` is opt-in; browser local-network permission policies can still block access. HTTPS pages cannot freely reach HTTP APIs. Certificate trust is enforced by the browser. Prefer same-origin HTTPS or loopback through SSH/Tailscale. Never automatically downgrade or strip authentication.

Built-in static hosting is `/dashboard/`; a populated user directory disables upstream auto-download. Vite relative assets and hash routing preserve refresh/navigation on `/dashboard/` and arbitrary independent static paths.

## Licensing and generation

Vendored proto is unmodified GPL-3.0-or-later, copyright nekohasekai / SagerNet; original notice in `proto/LICENSE.sing-box`. Generated code derives from it. Repository's existing AGPL-3.0 is preserved; GPLv3 section 13 permits combination with AGPLv3 under AGPL terms for the combined work. Distribute corresponding source, notices and both license texts. Official dashboard is also GPL-3.0-or-later: consulted for protocol only, no components/styles copied. Bun runs local Buf and protoc-gen-es pinned in bun.lock; `bun run proto:generate` needs no remote generator.

## Verification ledger

Source review verifies the contract above, not a deployed server. Runtime integration and browser results are recorded in `docs/verification.md` after execution. External VPS TLS, reverse-proxy buffering, CORS/PNA and large real workloads must be verified in the deployment environment.

Connection status: API 4 provides `closedAt` and CLOSED events plus closed history in initial snapshots. SingDeck derives Active/Closed only from those server fields; the contract has no independent Blocked flag. Rejected requests may never appear in tracking, so missing rows are not labeled blocked.
