# Native API compatibility

Research baseline: **sing-box v1.14.0**, commit `0b8995879f29a9b98ee027bc17b75e101445b238`.
Research completed before business implementation. Independent UI; no upstream dashboard UI code copied.

## Authoritative sources

- [Service API documentation](https://sing-box.sagernet.org/configuration/service/api/)
- [Pinned Protobuf](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/started_service.proto)
- [Pinned implementation](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/started_service.go)
- [HTTP bridge / CORS](https://github.com/SagerNet/sing-box/blob/v1.14.0/service/api/web_bridge.go)
- [Dashboard hosting](https://github.com/SagerNet/sing-box/blob/v1.14.0/service/api/dashboard.go)
- [Official dashboard transport reference](https://github.com/SagerNet/sing-box-dashboard/tree/main/src/api)

## Wire contract

Service: `daemon.StartedService`; POST `/<service>/<RPC>`. Native HTTP/2 gRPC and HTTP gRPC-Web binary/text are accepted. The bridge flushes streaming responses and embeds trailers in gRPC-Web frames. Connect **protocol** is not accepted: use ConnectRPC's `createGrpcWebTransport`, binary Protobuf and browser fetch readable streams. No WebSocket adapter is needed for the unary/server streams in P0. Browser client/bidirectional streams are outside P0.

Metadata: `authorization: Bearer <secret>`. No query credentials. Unary deadline 10s; subscription scope cancellation; status watchdog; bounded exponential reconnect for transient failures. Authentication, permission, unsupported API and malformed requests require correction, not an insecure retry/fallback.

`GetVersion` returns core `version` and integer `apiVersion`; **v1.14.0 uses API version 4**, not 1. SingDeck gates on API 4 and core >=1.14.0 stable; other API revisions fail explicitly until verified.

| RPC | Input | Output / semantics |
| --- | --- | --- |
| GetVersion | Empty | Version: version, apiVersion |
| SubscribeServiceStatus | Empty | stream ServiceStatus; IDLE/STARTING/STARTED/STOPPING/FATAL, errorMessage |
| SubscribeStatus | interval int64 **nanoseconds** | stream Status; memory bytes, connectionsIn/Out, trafficAvailable, interval byte deltas uplink/downlink, cumulative totals |
| SubscribeGroups | Empty | stream Groups.group[]; tag/type/selectable/selected/items |
| SelectOutbound | groupTag, outboundTag | Empty; await server response and groups subscription for selection |
| URLTest | outboundTag | Empty; latency results arrive through groups, not this response |
| SubscribeLog | Empty | stream Log.messages[] (level/message), reset flag; no server timestamp |
| GetDefaultLogLevel | Empty | DefaultLogLevel.level |
| SubscribeConnections | interval int64 nanoseconds | stream ConnectionEvents (reset + NEW/UPDATE/CLOSED); UPDATE deltas increment totals, CLOSED stores final counters/closedAt; Active/Closed filters use the timestamp |
| CloseConnection | id | Empty; closed state confirmed by stream |
| CloseAllConnections | Empty | Empty; destructive action requires confirmation |
| GetClashModeStatus | Empty | modeList/currentMode, NotFound if mode manager absent |
| SetClashMode | mode (field 3) | Empty; SDK only in P0 |
| GetStartedAt | Empty | startedAt Unix **milliseconds**, used for uptime |

Status rates must divide byte deltas by the selected interval in seconds. First status sample has no measured rate. Group urlTestTime is Unix **seconds**; 0 means no history; failed tests delete history, so missing history cannot distinguish untested from failed. A zero delay with a test timestamp is a valid sub-millisecond success truncated by the server and displays as 0 ms; negative delays are invalid data, not a fabricated timeout. Log receipt timestamps are local, clearly labeled. Missing/disabled traffic tracking is unavailable, never fabricated zero traffic.

## Browser security and deployment

Server CORS allows POST/GET/OPTIONS and Content-Type, Authorization, X-Grpc-Web, X-User-Agent, Grpc-Timeout; exposes gRPC status headers. Set explicit trusted origins (the upstream empty-list default is `*`). `access_control_allow_private_network` is opt-in; browser local-network permission policies can still block access. HTTPS pages cannot freely reach HTTP APIs. Certificate trust is enforced by the browser. Prefer same-origin HTTPS or loopback through SSH/Tailscale. Never automatically downgrade or strip authentication.

Built-in static hosting is `/dashboard/`; a populated user directory disables upstream auto-download. Vite relative assets and hash routing preserve refresh/navigation on `/dashboard/` and arbitrary independent static paths.

## Licensing and generation

Vendored proto is unmodified GPL-3.0-or-later, copyright nekohasekai / SagerNet; original notice in `proto/LICENSE.sing-box`. Generated code derives from it. Repository's existing AGPL-3.0 is preserved; GPLv3 section 13 permits combination with AGPLv3 under AGPL terms for the combined work. Distribute corresponding source, notices and both license texts. Official dashboard is also GPL-3.0-or-later: consulted for protocol only, no components/styles copied. Bun runs local Buf and protoc-gen-es pinned in bun.lock; `bun run proto:generate` needs no remote generator.

## Verification ledger

Source review verifies the contract above, not a deployed server. Runtime integration and browser results are recorded in `docs/verification.md` after execution. External VPS TLS, reverse-proxy buffering, CORS/PNA and large real workloads must be verified in the deployment environment.

Connection status: API 4 provides `closedAt` and CLOSED events plus closed history in initial snapshots. SingDeck derives Active/Closed only from those server fields; the contract has no independent Blocked flag. Rejected requests may never appear in tracking, so missing rows are not labeled blocked.
