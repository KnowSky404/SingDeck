# SingDeck contributor instructions

Use Bun for installs and scripts. Read `docs/api-compatibility.md` before changing the SDK. The contract is the unmodified v1.14.0 proto, not the Clash REST API. Regenerate with `bun run proto:generate`; do not edit generated files. Do not copy upstream dashboard UI.

Keep transport in `src/api/client.ts`, stream lifecycle/state in `src/api/session.ts`, and React consumption in the workspace provider/hooks. Both native and mock adapters implement `SingBoxClient`. Abort every request scope on disconnect/profile replacement. Treat interval values as nanoseconds on the wire and deltas as bytes per interval.

No credentials in localStorage/sessionStorage, URLs, errors, debug output, fixtures, screenshots or commits. Redact API error details; use fixed actionable errors. Do not weaken TLS or introduce public RPC relays. Mock mode must remain explicit; never fall back to it on real API failure.

Use semantic CSS tokens and existing shadcn/Radix primitives. Preserve keyboard access, visible focus and reduced-motion support. Test desktop and mobile when touching layout.

## Development workflow

These gates cover every change, including workflow policy. Use a dedicated branch and separate worktree based on verified current `origin/main`. Keep the primary checkout clean. Use atomic Conventional Commits and PRs targeting `main`. Never develop directly on or push directly to `main`. Preserve other work. Use `--force-with-lease` only if a rebase requires updating your own remote task branch.

Record the objective, bounded scope, acceptance, authorization, risk and base SHA before editing. Keep the current head, check evidence, review cycle, blockers and next action in the PR or ignored per-worktree `.task/` notes. Update at milestones. After a handoff or restart, reconcile those notes with current Git and CI. Keep secrets, private configs and real connection data out of notes and public records.

### Risk and gates

Classify by behavioral impact, data, dependencies and trust boundaries. Use the highest applicable level, raise uncertain cases, and reassess any expanded diff. Every change needs local diff inspection and green applicable CI.

| Risk | Typical change | Local verification | Review and acceptance |
| --- | --- | --- | --- |
| R0 | Ordinary docs or comments | Inspect the diff, links and affected commands | Independent review optional, no PRE |
| R1 | Isolated presentation or copy | Applicable lint/type checks and focused browser tests | Code review, security review when relevant, PRE based on impact |
| R2 | App feature, native API, state or performance | Affected tests, build and critical browser flows. Use pinned native integration when an API path changes | Code review, security review when relevant, PRE for candidate-facing changes and brief rollback notes |
| R3 | Auth, secrets, privacy, migrations, shared trust, or CI/release gates | Full affected suites, including negative and failure paths | Independent local review, code and security review, PRE or authorized equivalent, explicit compatibility, recovery and rollback |

Run applicable `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build` and Playwright coverage once per relevant input. Native integration uses `SING_BOX_BINARY` pointing to official 1.14.0. Label mock and real evidence separately. Local tests do not establish remote TLS/PNA behavior. CI uses a conservative full suite outside its ordinary-documentation allowlist. Review and CI can run in parallel. Record command, outcome, head/base, toolchain and relevant inputs in the PR. Reuse evidence for equivalent inputs only. Verify the affected scope when a fix, rebase or dependency change alters those inputs. Opening a PR after pushing an unchanged revision is not a new verification input.

### Review and convergence

Use independent local Codex `/review` for R3 and when risk warrants it (`codex review --base origin/main`, or `--uncommitted` before committing). Ask code reviewers to assess correctness and acceptance. Ask security reviewers to assess trust, integrity and privacy. Leave mechanical checks to CI. Let the configured remote bot run automatically. Never trigger it manually by comment, review request or workflow dispatch. Inspect final-head checks, reviews, threads and comments. Wait for an active review and triage credible findings even if a review is optional. If an automatic reviewer never starts, use the existing independent local review fallback for code review. A missing required security review needs an authorized equivalent or a recorded blocker.

Batch fixes. Block P0/P1 and material P2 findings affecting safety, integrity or acceptance. Record dispositions and evidence for fixes, false positives and reasonable deferrals. P3 and suggestions normally permit a follow-up. An old review or bot reaction alone does not clear a new head. Default review/fix limits are zero for R0, two for R1 and three for R2/R3. Count parallel reviews as one cycle and carry the count across sessions. If a blocker remains at the limit, record the evidence and options for the Owner and pause that change. Required checks and blockers still govern merge.

### Merge and release

Ready for merge means acceptance, applicable CI, review of the final head and relevant base, resolved blockers and recorded deferrals, plus required PRE and rollback evidence. Fail closed on failed, canceled, stale or missing required evidence. Merge via **rebase** only within task authorization and branch protection. Check the integrated result against candidate inputs, inspect its CI, and rerun affected verification if those inputs changed. After a verified, authorized merge, clean up its unused branch and worktree and fast-forward the primary checkout. Keep unmerged and unsaved work safe.

The Owner's authorized implementation flow covers branch push, PR creation, rebase merge and post-merge cleanup within its stated scope. Honor explicit PR-only delivery or acceptance boundaries. PRE deployment, production deployment, release publication, migrations and other external writes have separate authorization. Publish requested releases from merged source only. The release pipeline validates the exact tagged source and publishes the tested build. A prerelease publishes the archive. Stable Pages deployment is tied to an authorized stable release or authorized recovery from a matching published stable tag on the tested `main` commit. Record the deployed version and run applicable smoke checks after production deployment.

See [development](docs/development.md) for pinned baseline provenance, CI behavior, PRE evidence and repository settings.

For GitHub operations prefer authenticated `gh` (first check `gh auth status`); use Git for local changes and transport. Send any Markdown or multiline issue/PR prose via a quoted-heredoc temporary file and `--body-file`, never inline `--body`.

For Cloudflare use `cf` unless this project gains a Wrangler configuration. For global JS tooling prefer Bun, then pnpm, then npm.
