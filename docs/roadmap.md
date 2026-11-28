# Roadmap

SingDeck connects directly to the native sing-box Service API for control, diagnostics and observability. The [enhancement plan](native-api-enhancement-plan.md) lists acceptance criteria. The [RPC matrix](native-api-capabilities.md) records contract coverage, and the [verification record](verification.md) records executed checks.

| Milestone | Status | Scope |
| --- | --- | --- |
| v0.8.1 baseline | Implemented | Responsive static workspace, explicit native/demo entry, API 4 monitoring, proxy groups and URL testing, connection actions, ANSI logs, optional saved single connection, English/Simplified Chinese and light/dark/system themes. |
| Phase 1 · v0.9.0 target | Implemented and locally verified | Per-instance API capability registry, full Outbound inventory, network quality and STUN diagnostics, and configuration deprecation warnings. Keep verified results and open limits in the capability and verification records. |
| Phase 2 · v0.10.0 target | In development | Runtime Monitor, Connection Inspector with export and bulk disconnect, core log controls, native Clash Mode, and the Notification Center are available. Traffic Analytics is paused at the review limit with correctness fixes still pending. |
| Phase 3 · v0.11.0 target | Planned | The instance-roster candidate is held for credential and session isolation fixes. Quick switching, opt-in credential migration and a bounded multi-instance overview remain subject to phase acceptance. |
| Phase 4 · v0.12.0 target | In development | Settings shows read-only USB/IP counts and OpenConnect/OpenVPN endpoint status. Local software-device tests verified the shared and attached USB/IP counts. The RPC matrix tracks remaining service capabilities and the evidence required for browser bidirectional features. [VPN status PR](https://github.com/KnowSky404/SingDeck/pull/33) |
| Phase 5 · v1.0.0 target | In development | Overview ordering, chart windows, local runtime history, the default workspace page and preference-file import/export are available. Headed desktop Chromium installation is verified. Physical mobile installation and acceptance of the current release candidate remain open. [Default page PR](https://github.com/KnowSky404/SingDeck/pull/55) · [Preference files PR](https://github.com/KnowSky404/SingDeck/pull/57) · [Cross-tab layout fix](https://github.com/KnowSky404/SingDeck/pull/85) |

Versions are targets. Work is accepted against its phase criteria before moving to the next phase. Publication requires a separately authorized release.

## Next delivery sequence

1. **Finish Phase 2 with Traffic Analytics.** The R3 candidate reached its review limit. With maintainer authorization, reconcile its dependencies against current `origin/main` and address both correctness findings in one pass. After same-core recovery, keep cached connection history visible and disable current-list export and close actions until the replacement stream delivers its reset. Count each settled connection once across duplicate close events. Preserve coverage for duplicates and mark a genuinely unknown close as partial. Verify lifecycle and eviction, private exports and coverage labels with affected tests, the official 1.14.0/API 4 loopback fixture, and desktop and mobile production-preview flows. Assess the Inspector-to-Logs lookup and desktop notification permission follow-ups against the Phase 2 acceptance criteria.
2. **Resume Phase 3 with one active instance.** Verify that credential revocation targets the current record, endpoint edits invalidate stale connection attempts, and unrelated roster edits preserve the active temporary session. Validate switching and isolation before expanding migration or multi-instance measurements.
3. **Advance Phase 4 one read-only service at a time.** Start with Tailscale status and test compatible-core revalidation before restarting service streams. Use the [RPC matrix](native-api-capabilities.md) to choose the next verified capability. Keep VPN challenges and browser bidirectional features gated on their own controlled fixtures and applicable browser transport evidence.
4. **Close Phase 5 against the release candidate.** Reconcile remaining display-redaction work with current code. Verify physical mobile installation and the candidate's browser, hosting and recovery paths. Use prior workload evidence where the tested inputs still apply. Use the [release and deployment gates](development.md#candidates-and-publication) for publication.

On another machine, follow the [development setup](development.md), verify current `origin/main` and its CI, then create an isolated worktree for the selected task. Reconcile imported candidate commits and carried review cycles with the current base before editing. Record the exact source and verification in the PR or per-worktree notes.

## Current limits

- The application gates connections on stable sing-box 1.14.0 or later with Service API 4. See the [API compatibility contract](api-compatibility.md) and runtime evidence before relying on another core build.
- URL-test history can be absent after a failed test. An accepted request and a fresh measured result are distinct. Only one real instance can be configured and active in the baseline workspace.
- The verified static deployment paths use browser gRPC-Web. Taildrop sending, Tailscale SSH and USB device provision require a verified browser transport path. See the [deployment guide](deployment.md) for browser TLS and remote access requirements.
