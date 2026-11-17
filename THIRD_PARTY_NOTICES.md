# Third-party notices

SingDeck's original UI/application code is AGPL-3.0-or-later. The pre-existing root AGPLv3 `LICENSE` is retained.

## sing-box protocol

`proto/daemon/started_service.proto` is copied **unmodified** from SagerNet/sing-box v1.14.0, commit `0b8995879f29a9b98ee027bc17b75e101445b238`, path `daemon/started_service.proto`.

Copyright (C) 2022 by nekohasekai <contact-sagernet@sekai.icu>.

The upstream project is GPL-3.0-or-later. The original complete notice and license are preserved in `proto/LICENSE.sing-box`. Generated `src/proto/daemon/started_service_pb.ts` derives from that schema. GPLv3 section 13 permits combining with AGPLv3; the combined application's AGPL obligations do not remove original notices. Supply corresponding source when distributing. The official dashboard was consulted for protocol reference only; none of its UI components/pages/styles were copied.

Sources: [proto](https://github.com/SagerNet/sing-box/blob/v1.14.0/daemon/started_service.proto), [license](https://github.com/SagerNet/sing-box/blob/v1.14.0/LICENSE), [GPLv3 section 13](https://www.gnu.org/licenses/gpl-3.0.html#section13).

## Application dependencies

| Component | License |
| --- | --- |
| React / React DOM | MIT |
| shadcn/ui source / Radix UI | MIT |
| ConnectRPC | Apache-2.0 |
| Protobuf ES (including Google well-known types) | Apache-2.0 AND BSD-3-Clause |
| Recharts | MIT |
| Lucide | ISC |
| Tailwind CSS / clsx / tailwind-merge / class-variance-authority | MIT |
| tw-animate-css / strip-ansi / ansi-regex | MIT |
| Geist font | SIL Open Font License 1.1 |

Exact package versions are in `bun.lock`. Package license texts, including transitive runtime dependencies, are bundled in `public/third-party-licenses.txt` and copied to `dist/third-party-licenses.txt`. Update that notice inventory if dependencies change. Generated shadcn source is independently restyled with SingDeck tokens.
