# Contributing

SingDeck is independently implemented. Keep changes small and trace protocol behavior back to the pinned upstream schema/source. Read [development](docs/development.md), [architecture](docs/architecture.md) and [API compatibility](docs/api-compatibility.md).

1. Use a dedicated branch and separate worktree on verified `origin/main`. Define the scope, acceptance and risk using [AGENTS.md](AGENTS.md).
2. Install Bun 1.4.4 and Node 24+. Run `bun install --frozen-lockfile`. Start with `bun run dev` and choose **Explore demo**, or configure a trusted local instance.
3. Verify affected behavior with the commands in [development](docs/development.md). Preserve cancellation, credential handling and truthful data semantics. Regenerate the schema and verify the official core when changing the protocol.
4. Open a PR against `main` and record exact check inputs, mock versus official-core evidence, and candidate or rollback details where applicable. Let CI and automatic review run in parallel. Resolve blocking findings in batches.
5. Rebase-merge with authorized, current evidence. Verify the integration and clean up merged work. Use the separate release flow for an authorized publication or production deployment.

Use Conventional Commits. Submit reproducible bug reports without tokens, private proxy configurations, real connection metadata or unredacted logs. Never hand-edit generated files. New dependency choices must solve an actual problem and have compatible licenses. By contributing, you license contributions under AGPL-3.0-or-later; upstream protocol material retains its GPL notice.
