# Roadmap

## P0 — initial usable release

Implemented: independent responsive shell and tokens; light/dark/system themes; explicit mock and native adapters; typed generated API 4 SDK; bounded/cancelable/reconnecting streams; explicit connect/demo entry; overview metrics/chart; collapsible searchable/list/card proxy groups and server-confirmed selector changes; connection search/network/outbound filter/sort/details/paginated rendering/close actions; bounded ANSI-colored logs with plain-text search/export and filters, pause, autoscroll, local clear, copy/export; connection settings and metadata profile persistence; unit/browser/official-binary tests and CI; both static deployment paths.

Limits are visible, not simulated success: no-result test history cannot distinguish failures from untested nodes; unknown API revisions are gated; absent capabilities are unavailable; only one real profile can be edited in the current UI; remote HTTP is refused. Runtime evidence and remaining checks live in `verification.md`.

## P1 — next iterations

1. Full multi-profile create/delete/reorder and quick-switch UX, with per-profile secret handling and broader isolation tests; keep one active scope initially.
2. Real-world deployment validation across reverse proxies, trusted TLS, browser local-network policies, Firefox/WebKit and high-volume instances; add targeted compatibility fixtures before widening the API gate.
3. URL-test progress/result freshness UX based on authoritative available data; network-quality and STUN streaming tools; optional native Clash Mode management without a Clash REST dependency.

Then advanced outbound statistics, traffic history visualization, English/Chinese localization, PWA with a deliberate sensitive-data caching policy, and customizable dashboard layouts. No implied backend or long-term traffic retention in P0.

## P2 — longer term

Multi-instance aggregate monitoring, Tailscale status/tools, deeper connection analysis, health events/notifications, optional controlled server extensions and an extensible plugin model. Scope these only when actual deployments justify their complexity. Preserve native protocol, credential isolation and explicit capabilities throughout.
