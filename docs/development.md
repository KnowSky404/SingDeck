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
| `bun run test:integration` | Official-core integration, requires the fixture when applicable |

Install browser runtime once with `bunx playwright install chromium`; on a new Linux CI host use `bunx playwright install --with-deps chromium`. Playwright starts its own dev server at `http://127.0.0.1:4173`. Set `SINGDECK_E2E_PORT` to a free port if 4173 is already in use. No Browser plugin is available in the implementation environment, so browser validation uses regular Playwright.

## Mock workflow

Start the app and select **Explore demo**. The header always says Mock mode. All five pages receive generated message types. Outage and mutation-failure controls remain internal test fixtures, without a product sandbox screen. Session unit tests exercise reconnection and rejected RPCs. No real endpoint is contacted. Reload starts disconnected and requires explicitly choosing demo again.

## Real service integration

Obtain the official 1.14.0 Linux binary with authenticated GitHub CLI:

```sh
gh auth status --hostname github.com
gh release download v1.14.0 --repo SagerNet/sing-box \
  --pattern sing-box-1.14.0-linux-amd64.tar.gz --dir /tmp/singdeck-fixture
tar --no-same-owner -xzf /tmp/singdeck-fixture/sing-box-1.14.0-linux-amd64.tar.gz -C /tmp/singdeck-fixture
bun run build
SING_BOX_BINARY=/tmp/singdeck-fixture/sing-box-1.14.0-linux-amd64/sing-box bun run test:integration
SING_BOX_BINARY=/tmp/singdeck-fixture/sing-box-1.14.0-linux-amd64/sing-box bun run test:e2e -- 'e2e/(native|usbip)\.spec\.ts$' --project desktop --workers 1
```

Create `/tmp/singdeck-fixture` first. Integration tests generate disposable credentials in a mode-0600 temporary config, bind API/proxy listeners on loopback (19090/19080 for SDK tests, 19190/19180 for the general native browser tests, and OS-assigned ports for the USB/IP browser test), use only local test proxy traffic and clean up. Do not run them against production. The sample config has no Clash API; mode RPC tests prove native NotFound behavior rather than claiming absent capabilities work. No live latency probe over the public internet is required for tests.

For manual use, copy `examples/sing-box-1.14.0.json` outside the repo, replace the explicitly named secret placeholder, and run `sing-box check -c /path/to/config.json`, then `sing-box run -c /path/to/config.json` from the repo root so `./dist` resolves correctly. Set the matching listener endpoint and token in the entry form. Use the documented allowed loopback origins for development. Empty or failed data stays explicit.

## Dependency notices

After a runtime dependency change run `bun run licenses:generate` and review the notice diff. The script has assertions for missing license texts; supplemental upstream texts and provenance are in `licenses/`. CI checks the notice inventory remains reproducible.

## Schema updates

Read upstream implementation and license changes first. Replace the raw schema only from the intended official release, update its commit provenance and API gate, run `bun run proto:generate`, review the generated diff, update both adapter implementations and protocol tests, then verify the official binary. CI verifies regeneration creates no diff. Do not assume a new core/API revision is compatible because it compiles.

## Restricted workspace environment

The normal commands need no environment overrides on a developer machine. This managed workspace only permits writes in the checkout and `/tmp`. The implementation checks used `BUN_TMPDIR=/tmp`, `BUN_INSTALL_CACHE_DIR=/tmp/singdeck-bun-cache`, `BUF_CACHE_DIR=/tmp/singdeck-buf-cache` and `PLAYWRIGHT_BROWSERS_PATH=/tmp/singdeck-browsers` where the corresponding tool's home cache was read-only. These are filesystem adaptations, not application settings.

## Worktrees, review, PRs and releases

Use [AGENTS.md](../AGENTS.md) for the local risk and review rules. They adapt the [Manifest engineering baseline at `980c4d7`](https://github.com/KnowSky404/Manifest/blob/980c4d7d8c92f50c8e1931c419049165da9df5ef/docs/AI_NATIVE_DEVELOPMENT_WORKFLOW.md). Adopt baseline revisions through a deliberate PR. The migration PR follows the gates in effect when that task began.

Keep compact state in ignored `.task/` notes within each worktree. Record the objective, scope, acceptance, risk, authorization, base and branch in `.task/task.md`. Update `.task/progress.md` at milestones with head, check evidence, review cycle and dispositions, candidate evidence, blockers and the next action. Use the PR for sanitized handoff across hosts. Reconcile the notes against `git status`, the current base/head and remote checks before resuming.

### CI and review evidence

- CI emits `check` for PRs opened, synchronized or reopened against `main`, and for every push to `main`. Feature pushes and tags have no standalone push CI. Title and body edits leave the current source checks in place. Fresh events for the same PR can cancel superseded verification. Manual reruns use separate concurrency groups.
- After retargeting a PR to `main`, require a fresh `check` for the exact current head and `main` base before merging. A source update or an authorized reopen starts that check.
- An allowlisted ordinary-documentation PR runs a smaller check with a production build. Eligibility uses the verified PR merge commit and its trusted base. A checkout whose parents differ from the PR event fails the check. Unknown paths, configuration, workflow and application changes take the full route. The full route verifies generated schema and license notices, lint, type/build, unit tests and browser behavior. It verifies the official-core fixture by digest and runs `e2e/native.spec.ts` and `e2e/usbip.spec.ts` separately from the demo browser suite on desktop with one worker. Main and publication always run the full route. Workflow actions use pinned commit SHAs. CI does not upload Playwright traces.
- A PR's risk and local evidence remain the author's responsibility. A low-risk UI change can use targeted local lint and desktop/mobile tests. A changed native API or state path needs affected unit and native checks. Auth, privacy and critical workflow changes also need independent local review and relevant negative-path acceptance. Describe official-binary versus demo evidence in the PR.
- Use the status/check run for the current PR head and tested base. Reuse earlier local evidence for identical tested inputs. A docs classification does not prove build equivalence because Tailwind can scan Markdown for CSS classes. After a fix, retry affected tests and revisit the original finding before expanding coverage. Record failures, missing evidence and deferrals. A canceled or skipped required result does not pass.
- Automatic reviews run in parallel with CI. Inspect current review threads and findings as well as check results. The bot can report through comments. The authorized merge actor verifies completion and dispositions, including the independent fallback in [AGENTS.md](../AGENTS.md) when applicable.

SingDeck adopts the conservative full CI route for every non-allowlisted PR, even when some R1 checks could be reduced further. It keeps rebase merges and the existing automatic-review provider. For example, before adoption [PR #17](https://github.com/KnowSky404/SingDeck/pull/17) ran the full check twice for the same feature head, once for the branch push and once for the PR. Its merged revision then ran main-push CI, a second push CI on tagging and [release CI](https://github.com/KnowSky404/SingDeck/actions/runs/45956326830). Keep a compact record in PRs of check duration/count, review cycles, PRE attempts and recoveries. Record production smoke outcomes when applicable.

### GitHub settings

At adoption, GitHub reported no branch protection or effective rules for `main`. Enable an active ruleset targeting `main` in **Settings → Rules → Rulesets** after a successful PR run confirms the check name. Require a pull request and successful GitHub Actions `check`. Require the branch to be up to date before merging. Enable linear history for rebase merges, block force pushes and deletions, and keep the bypass list empty. A solo maintainer can leave the count of GitHub-human approvals at zero and still follow the code and security review requirements above. Verify the rule against a PR that has an active check before relying on it. Without an active rule, the authorized merge actor must enforce the same criteria.

### Candidates and publication

DEV uses local mocks or a trusted isolated core. PRE uses a verified production build for acceptance when required. A local production preview or a verified downloadable archive can serve as PRE. A shared candidate needs an exclusive slot and separate deployment authorization. Record tested head/base or tree, frozen build inputs, artifact digest, nonsecret environment identity and accepted behavior. For R3, exercise relevant negative paths and check compatibility, recovery and rollback. Label earlier debugging previews separately from an accepted candidate.

After an authorized rebase merge, verify the integrated commit and main CI. Compare candidate and integrated source, lockfile, toolchain, configuration and output. If a changed base, version or artifact invalidates acceptance, rebuild and repeat the impacted verification. Reuse an accepted artifact only when its evidence applies to the exact build and inputs.

For a requested release, bump `package.json` in a PR and publish its matching `v<version>` from the verified integrated commit. Release CI fetches the current remote `main` and release tag to validate ancestry and tag identity. It verifies the version and agreement between the SemVer prerelease suffix and GitHub's prerelease field. It runs the full checks, then uses the tested `dist/` artifact for ZIPs and, for a stable release, Pages. Failed CI blocks those outputs. Prereleases deliver their archive without promoting it to Pages. A recovery dispatch requires separate production authorization, the full CI gate and a matching published stable release whose tag points to the tested `main` commit. Retry failed work only after checking the prior run and deployed identity. Avoid redeploying a healthy release for an asset-only retry.

After production deployment, check the target identity and reported version and exercise applicable smoke flows with demo data unless explicitly authorized to use a trusted real instance. Record the result and escalate a failed smoke. Keep the known-good archive and release identity for recovery. If source correction is needed, use a revert or forward fix PR and authorize the next stable publication. For changes to persisted data, specify compatibility and recovery before release. Rebuilding static assets does not restore data.
