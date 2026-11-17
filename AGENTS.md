# SingDeck contributor instructions

Use Bun for installs and scripts. Read `docs/api-compatibility.md` before changing the SDK. The contract is the unmodified v1.14.0 proto, not the Clash REST API. Regenerate with `bun run proto:generate`; do not edit generated files. Do not copy upstream dashboard UI.

Keep transport in `src/api/client.ts`, stream lifecycle/state in `src/api/session.ts`, and React consumption in the workspace provider/hooks. Both native and mock adapters implement `SingBoxClient`. Abort every request scope on disconnect/profile replacement. Treat interval values as nanoseconds on the wire and deltas as bytes per interval.

No credentials in localStorage/sessionStorage, URLs, errors, debug output, fixtures, screenshots or commits. Redact API error details; use fixed actionable errors. Do not weaken TLS or introduce public RPC relays. Mock mode must remain explicit; never fall back to it on real API failure.

Use semantic CSS tokens and existing shadcn/Radix primitives. Preserve keyboard access, visible focus and reduced-motion support. Test desktop and mobile when touching layout.

Before committing run `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build` and relevant Playwright flows. Native integration requires `SING_BOX_BINARY` pointing to official 1.14.0. State clearly which checks used mock data. Do not claim remote TLS/PNA deployment verification from local tests.

Create atomic Conventional Commits for task changes; preserve unrelated edits. Do not push, publish or merge without task authorization. For GitHub operations prefer authenticated `gh` (first check `gh auth status`); use Git for local changes and transport. Send any Markdown or multiline issue/PR prose via a quoted-heredoc temporary file and `--body-file`, never inline `--body`.

For Cloudflare use `cf` unless this project gains a Wrangler configuration. For global JS tooling prefer Bun, then pnpm, then npm.
