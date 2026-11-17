# Development

Use Bun 1.4.4 and Node 24+. `bun install --frozen-lockfile` installs the exact checked-in dependency graph. The project uses the public HTTPS npm registry via `bunfig.toml`; lockfile tarball URLs must remain publicly reachable so GitHub-hosted runners can install them. TypeScript 6 is deliberate tooling compatibility, not an accidental outdated selection.

| Command | Purpose |
| --- | --- |
| `bun install` | Install dependencies; lockfile is committed |
| `bun run dev` | Vite dev server, default port 5173 |
| `bun run build` | Strict type check and optimized static production build |
| `bun run preview` | Preview `dist`, default port 4173 |
| `bun run lint` | ESLint, TS and React hook rules, zero warnings |
| `bun run typecheck` | Strict TS across app, tests and tooling |
| `bun run test` | Vitest protocol/state/session unit tests |
| `bun run test:e2e` | Chromium desktop + mobile interaction suite |
| `bun run proto:generate` | Local Buf/protoc-gen-es generation from pinned schema |
| `bun run test:integration` | Optional official-binary integration, skips without binary |

Install browser runtime once with `bunx playwright install chromium`; on a new Linux CI host use `bunx playwright install --with-deps chromium`. Playwright starts a dev server at `http://127.0.0.1:4173` unless one already exists. No Browser plugin is available in the implementation environment, so browser validation uses regular Playwright.

## Mock workflow

Start the app and select **Explore demo** (or choose Demo workspace in the instance selector). The header always says Mock mode. All five pages receive generated message types. Settings → Development sandbox can interrupt streams; disabling the interruption exercises reconnect. Fail next mutation rejects the next select, test or close RPC. No real endpoint is contacted. Reload starts disconnected and requires explicitly choosing demo again.

## Real service integration

Obtain the official 1.14.0 Linux binary with authenticated GitHub CLI:

```sh
gh auth status --hostname github.com
gh release download v1.14.0 --repo SagerNet/sing-box \
  --pattern sing-box-1.14.0-linux-amd64.tar.gz --dir /tmp/singdeck-fixture
tar --no-same-owner -xzf /tmp/singdeck-fixture/sing-box-1.14.0-linux-amd64.tar.gz -C /tmp/singdeck-fixture
bun run build
SING_BOX_BINARY=/tmp/singdeck-fixture/sing-box-1.14.0-linux-amd64/sing-box bun run test:integration
SING_BOX_BINARY=/tmp/singdeck-fixture/sing-box-1.14.0-linux-amd64/sing-box bun run test:e2e -- e2e/native.spec.ts --project desktop
```

Create `/tmp/singdeck-fixture` first. Integration tests generate disposable credentials in a mode-0600 temporary config, bind API/proxy listeners on loopback (19090/19080 for SDK tests; 19190/19180 for browser tests), use only local test proxy traffic and clean up. Do not run them against production. The sample config has no Clash API; mode RPC tests prove native NotFound behavior rather than claiming absent capabilities work. No live latency probe over the public internet is required for tests.

For manual use, copy `examples/sing-box-1.14.0.json` outside the repo, replace the explicitly named secret placeholder, and run `sing-box check -c /path/to/config.json`, then `sing-box run -c /path/to/config.json` from the repo root so `./dist` resolves correctly. Set the matching listener endpoint and token in Settings. Use the documented allowed loopback origins for development. Empty or failed data stays explicit.

## Dependency notices

After a runtime dependency change run `bun run licenses:generate` and review the notice diff. The script has assertions for missing license texts; supplemental upstream texts and provenance are in `licenses/`. CI checks the notice inventory remains reproducible.

## Schema updates

Read upstream implementation and license changes first. Replace the raw schema only from the intended official release, update its commit provenance and API gate, run `bun run proto:generate`, review the generated diff, update both adapter implementations and protocol tests, then verify the official binary. CI verifies regeneration creates no diff. Do not assume a new core/API revision is compatible because it compiles.

## Restricted workspace environment

The normal commands need no environment overrides on a developer machine. This managed workspace only permits writes in the checkout and `/tmp`. The implementation checks used `BUN_TMPDIR=/tmp`, `BUN_INSTALL_CACHE_DIR=/tmp/singdeck-bun-cache`, `BUF_CACHE_DIR=/tmp/singdeck-buf-cache` and `PLAYWRIGHT_BROWSERS_PATH=/tmp/singdeck-browsers` where the corresponding tool's home cache was read-only. These are filesystem adaptations, not application settings.

## Worktrees, review, PRs and releases

All changes use a separate worktree and feature branch. Before every push and before opening a PR, run local Codex `/review` (`codex review --base origin/main`), fix findings, and rerun the relevant checks/review. Let the configured Codex bot review automatically; do not manually invoke it. After green CI and any automatically triggered review is clear (or none triggered), rebase-merge the PR and remove its branch/worktree. The detailed mandatory process is in [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

For a requested release, bump `package.json` through that PR flow. Create the matching `v<version>` release from the merged commit. The release workflow verifies tag/version and main ancestry, executes the full reusable CI (including browsers and official-binary integration), uploads that tested build, then deploys Pages and attaches a static ZIP. Failed CI does not publish Pages or an archive. A manual Pages dispatch uses the same CI gate. This workflow never invokes a Codex bot.
