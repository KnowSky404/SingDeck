# Contributing

SingDeck is independently implemented. Keep changes small and trace protocol behavior back to the pinned upstream schema/source. Read [development](docs/development.md), [architecture](docs/architecture.md) and [API compatibility](docs/api-compatibility.md).

1. Create a dedicated branch in a separate Git worktree based on the latest `origin/main`. Do not develop directly in the primary checkout or push to `main`.
2. Install Bun 1.4.4 and Node 24+ (Node runs the ESLint and browser tooling).
3. `bun install --frozen-lockfile`
4. `bun run dev` and explicitly select Explore demo, or configure a trusted local instance.
5. Add focused coverage for state, protocol or user-flow changes. Tests must preserve cancellation, credentials and truthful data semantics.
6. Run `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:e2e`.
7. For protocol changes, regenerate the schema and run the optional official-binary integration suites described in development docs. Explain mock versus real evidence in the PR.

Before every branch push and before creating a PR, run a local Codex `/review` (CLI: `codex review --base origin/main`), resolve actionable findings and rerun relevant checks/review. If review cannot run, report it instead of bypassing the gate. Push the branch and open a PR against `main`, with validation and review results. New commits, fixes and rebases require the same local review before pushing.

Codex bot review must trigger automatically. Never post a manual trigger, request the bot or dispatch a bot-review workflow. Inspect review/check state for the latest commit. Wait for an active automatic review and resolve its findings. If none triggered automatically, proceed without invoking it once required CI and local review pass.

Merge clean PRs using **rebase**, then verify the merge, delete the remote branch, remove the clean worktree, delete its local branch and fast-forward the primary checkout. Keep unmerged/user changes safe. Publish requested releases only from merged source, with release CI gating Pages deployment. See [AGENTS.md](AGENTS.md) for the complete workflow.

Use Conventional Commits. Submit reproducible bug reports without tokens, private proxy configurations, real connection metadata or unredacted logs. Never hand-edit generated files. New dependency choices must solve an actual problem and have compatible licenses. By contributing, you license contributions under AGPL-3.0-or-later; upstream protocol material retains its GPL notice.
