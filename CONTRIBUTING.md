# Contributing

SingDeck is independently implemented. Keep changes small and trace protocol behavior back to the pinned upstream schema/source. Read [development](docs/development.md), [architecture](docs/architecture.md) and [API compatibility](docs/api-compatibility.md).

1. Install Bun 1.4.4 and Node 24+ (Node runs the ESLint and browser tooling).
2. `bun install --frozen-lockfile`
3. `bun run dev` and explicitly select Explore demo, or configure a trusted local instance.
4. Add focused coverage for state, protocol or user-flow changes. Tests must preserve cancellation, credentials and truthful data semantics.
5. Run `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:e2e`.
6. For protocol changes, regenerate the schema and run the optional official-binary integration suites described in development docs. Explain mock versus real evidence in the PR.

Use Conventional Commits. Submit reproducible bug reports without tokens, private proxy configurations, real connection metadata or unredacted logs. Never hand-edit generated files. New dependency choices must solve an actual problem and have compatible licenses. By contributing, you license contributions under AGPL-3.0-or-later; upstream protocol material retains its GPL notice.
