# Static deployment

Build once with `bun install --frozen-lockfile` and `bun run build`. Deploy **the contents of `dist/`**. No backend, environment-injected secrets or RPC forwarding is needed. Vite uses relative asset URLs; navigation uses hashes, so both `/dashboard/#/logs` and an arbitrary static subdirectory survive refresh without an HTML fallback rule.

## A. sing-box built-in dashboard

The included [1.14.0 example](../examples/sing-box-1.14.0.json) was validated using the actual release binary, including `sing-box check`. It listens on loopback only, configures an explicit secret placeholder and serves `./dist` at `/dashboard/`.

1. Copy the example outside version control. Replace `REPLACE_WITH_A_LONG_RANDOM_SECRET` with a strong unique secret. Restrict the configuration file's read permissions. Never add the private config to this repository.
2. Set `dashboard.path` to the absolute directory containing the built `index.html` and `assets/`. Alternatively keep `./dist` and launch sing-box from the project root.
3. Run `sing-box check -c /path/to/private-config.json`, then `sing-box run -c /path/to/private-config.json`.
4. Open `http://127.0.0.1:19090/dashboard/`. In Settings, use `http://127.0.0.1:19090` as the API endpoint and enter the secret. Test connection, then Save & connect.

For a VPS, retain loopback bindings and use an SSH tunnel from your own computer:

```sh
ssh -N -L 19090:127.0.0.1:19090 user@your-vps
```

Then open the same local dashboard URL. The dashboard uses the browser-visible endpoint, not the VPS's private address. Use a dedicated HTTPS listener/reverse proxy or a trusted Tailscale path for persistent remote access. Remote plain HTTP is rejected by SingDeck. Do not disable certificate checks.

A populated custom dashboard directory is served as-is by sing-box and prevents upstream auto-download. Do not copy an upstream `.etag` file into the directory. The sample's outbounds are direct connections for reproducible integration, not a production proxy configuration; add your real outbounds privately.

## B. independent static hosting

Upload `dist/` to any static HTTPS host, including a subdirectory. Configure the real HTTPS API endpoint and Bearer token in the browser. No runtime environment file is needed. Do not embed tokens in a Vite variable: all Vite client variables are public.

On the sing-box API service, set `access_control_allow_origin` to the exact dashboard origin (scheme, hostname, port; no path/trailing slash), e.g. `https://dashboard.example.org`. The native server handles OPTIONS/POST and the required gRPC-Web authentication/status headers. Preserve the full `/daemon.StartedService/<Method>` path if routing via a prefix.

For HTTPS reverse proxies, forward binary POST bodies, authorization and gRPC status headers, disable response buffering for server streams, and allow long streaming responses. Terminate TLS with a browser-trusted certificate; never create a publicly accessible unauthenticated relay. Prefer same-origin deployment to minimize browser policy issues. Use a restrictive CSP suited to your host, including `connect-src` only for explicitly trusted API origins; do not permit arbitrary third-party scripts on a management dashboard.

## GitHub Pages preview

The repository publishes to [https://knowsky404.github.io/SingDeck/](https://knowsky404.github.io/SingDeck/). Click **Explore demo** for the clearly labeled simulated workspace. The public site contains only frontend assets; no private API credentials or backend relay are deployed.

`.github/workflows/pages.yml` runs when a release is published, or when explicitly dispatched. It calls the full reusable CI workflow, then deploys the exact verified `dist/` artifact to Pages after all checks pass. Stable releases update Pages; prereleases only receive their tested archive. The workflow also attaches `singdeck-<tag>.zip` to a release. A published tag must match `package.json` and point to a commit already merged into `main`. Branch/PR CI continues to run independently; pushes to `main` do not publish Pages before a release. Repository Settings → Pages must use **GitHub Actions** as the source. Relative assets and hash routes work under `/SingDeck/` without changing the built-in `/dashboard/` deployment.

For a real connection from this preview, use your own trusted HTTPS API and allow the exact CORS origin `https://knowsky404.github.io` (without `/SingDeck/`). Plain HTTP APIs may be blocked by mixed-content policy; private-network endpoints also depend on browser permissions. Tokens remain in browser memory.

## Diagnosing access failures

| Symptom | Check |
| --- | --- |
| Authentication failed | Secret must match Bearer token; no query auth, cookies or URL credentials |
| Connection interrupted | Listener address, trusted TLS chain, exact CORS origin and browser network console |
| HTTPS dashboard → HTTP API | Mixed content; use HTTPS or same-origin/tunnel deployment |
| Browser local/private network denial | Browser permission, secure context and optional `access_control_allow_private_network`; CORS alone cannot override browser policy |
| Connected, missing groups | The instance may have no visible group outbounds |
| Missing traffic/connections | Tracking capability unavailable; UI marks it explicitly |
| Graph stops behind reverse proxy | Disable buffering and increase streaming timeout |
| Reload loses token | Expected: credentials are memory only; re-enter them |
| API version unsupported | Only API 4 and stable core ≥1.14.0 are accepted; verify new versions before upgrading the gate |

Local HTTP SDK/browser tests prove baseline transport, CORS, streaming and built-in hosting. They do **not** establish external VPS TLS/PNA correctness. Verify those policies in your target browser and network before using remote management. See [verification](verification.md).

## Source and licenses

Distribute the corresponding SingDeck source and retain `LICENSE`, `proto/LICENSE.sing-box`, `THIRD_PARTY_NOTICES.md` and bundled license notices when redistributing the dashboard. Public hosting does not remove applicable source obligations. The footer links to the upstream source repository; downstream deployments must offer their actual corresponding modified source and update that link. The static build also includes AGPL and upstream GPL license texts. Build artifacts contain no access credentials.
