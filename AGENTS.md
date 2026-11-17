# SingDeck contributor instructions

Use Bun for installs and scripts. Read `docs/api-compatibility.md` before changing the SDK. The contract is the unmodified v1.14.0 proto, not the Clash REST API. Regenerate with `bun run proto:generate`; do not edit generated files. Do not copy upstream dashboard UI.

Keep transport in `src/api/client.ts`, stream lifecycle/state in `src/api/session.ts`, and React consumption in the workspace provider/hooks. Both native and mock adapters implement `SingBoxClient`. Abort every request scope on disconnect/profile replacement. Treat interval values as nanoseconds on the wire and deltas as bytes per interval.

No credentials in localStorage/sessionStorage, URLs, errors, debug output, fixtures, screenshots or commits. Redact API error details; use fixed actionable errors. Do not weaken TLS or introduce public RPC relays. Mock mode must remain explicit; never fall back to it on real API failure.

Use semantic CSS tokens and existing shadcn/Radix primitives. Preserve keyboard access, visible focus and reduced-motion support. Test desktop and mobile when touching layout.

Before committing run `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build` and relevant Playwright flows. Native integration requires `SING_BOX_BINARY` pointing to official 1.14.0. State clearly which checks used mock data. Do not claim remote TLS/PNA deployment verification from local tests.

## Mandatory development workflow

These rules apply to every feature, bug fix, refactor, test, documentation and configuration change, including changes to these instructions.

1. Develop in a separate Git worktree on a dedicated branch based on the latest `origin/main`. Keep the primary checkout clean. Never develop directly on or push changes directly to `main`.
2. Run the required local checks and a local Codex `/review` before **every push** and again before creating a PR. The CLI equivalent is `codex review --base origin/main` (or `codex review --uncommitted` before committing). Inspect the related callers/tests, fix actionable findings and rerun the affected checks/review until there are no unresolved findings. If local review cannot run, report the blocker; do not silently claim it passed or push/create the PR.
3. Create atomic Conventional Commits, push the feature branch and create a PR targeting `main`. Record validation and the local review result in the PR. Preserve unrelated edits. Before a push after rebasing or any review fix, repeat the local checks/review; use `--force-with-lease` only when an existing branch must be updated after a rebase.
4. Let the configured Codex bot review automatically. **Never manually trigger the bot**: no `@codex review` comments, manual review requests or dispatching a bot-review workflow. Inspect checks, reviews, review threads and comments for the latest PR head. If an automatic review is running, wait for it, fix its actionable findings through the same local-review/push cycle, and wait for the updated review. A review of an older commit is not clearance for a newer commit.
5. Once required CI checks pass and an automatically triggered Codex review has finished with no unresolved issues, merge using **rebase**. If no Codex review was automatically triggered, do not invoke it or wait indefinitely; merge with rebase once required checks are green and the local review passed. Do not override branch protections or merge a known pending/failed review.
6. After a verified merge, delete the remote feature branch, remove its development worktree, delete the local branch and fast-forward the primary checkout to `origin/main`. Do not discard uncommitted/unmerged work while cleaning up.
7. Publish a release only when requested, after the PR is merged. Release CI must validate the tagged source before publishing its Pages build; never deploy a failed or unrelated build as that release.

The user's explicit request to implement work through this flow authorizes its branch push, PR creation, rebase merge and post-merge cleanup. Do not request repeated confirmation for those steps. Releases and other external writes still need task authorization.

For GitHub operations prefer authenticated `gh` (first check `gh auth status`); use Git for local changes and transport. Send any Markdown or multiline issue/PR prose via a quoted-heredoc temporary file and `--body-file`, never inline `--body`.

For Cloudflare use `cf` unless this project gains a Wrangler configuration. For global JS tooling prefer Bun, then pnpm, then npm.
