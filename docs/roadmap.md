# Roadmap

SingDeck connects directly to the native sing-box Service API for control, diagnostics and observability. The [enhancement plan](native-api-enhancement-plan.md) lists acceptance criteria. The [RPC matrix](native-api-capabilities.md) records contract coverage, and the [verification record](verification.md) records executed checks.

| Milestone | Status | Scope |
| --- | --- | --- |
| v0.8.1 baseline | Implemented | Responsive static workspace, explicit native/demo entry, API 4 monitoring, proxy groups and URL testing, connection actions, ANSI logs, optional saved single connection, English/Simplified Chinese and light/dark/system themes. |
| Phase 1 · v0.9.0 target | Implemented and locally verified | Per-instance API capability registry, full Outbound inventory, network quality and STUN diagnostics, and configuration deprecation warnings. Keep verified results and open limits in the capability and verification records. |
| Phase 2 · v0.10.0 target | Planned | Runtime monitor, connection inspector, traffic analytics, native and local notifications, native Clash Mode, and log/group refinements. |
| Phase 3 · v0.11.0 target | Planned | Instance management and quick switch, session isolation, opt-in multi-instance credential migration, and evaluation of a bounded multi-instance overview. |
| Phase 4 · v0.12.0 target | Planned | Capability-gated Tailscale, Taildrop, OpenConnect, OpenVPN, and USB/IP. Browser gRPC-Web bidirectional features require separate transport verification. |
| Phase 5 · v1.0.0 target | Planned | Reconnect and performance work with measured workloads, cross-browser/deployment checks, security audit, and evaluation of installable/custom workspaces. |

Versions are targets. Work is accepted against its phase criteria before moving to the next phase. Publication requires a separately authorized release.

## Current limits

- The application gates connections on stable sing-box 1.14.0 or later with Service API 4. See the [API compatibility contract](api-compatibility.md) and runtime evidence before relying on another core build.
- URL-test history can be absent after a failed test. An accepted request and a fresh measured result are distinct. Only one real instance can be configured and active in the baseline workspace.
- The verified static deployment paths use browser gRPC-Web. Taildrop sending, Tailscale SSH and USB device provision require a verified browser transport path. See the [deployment guide](deployment.md) for browser TLS and remote access requirements.
