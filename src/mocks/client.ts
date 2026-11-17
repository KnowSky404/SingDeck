import { clone, create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import type { SingBoxClient } from "@/api/client";
import { delay } from "@/api/errors";
import {
  VersionSchema,
  ServiceStatusSchema,
  ServiceStatus_Type,
  StatusSchema,
  GroupsSchema,
  GroupSchema,
  GroupItemSchema,
  LogSchema,
  LogLevel,
  DefaultLogLevelSchema,
  ConnectionEventsSchema,
  ConnectionEventSchema,
  ConnectionEventType,
  ConnectionSchema,
  StartedAtSchema,
  ClashModeStatusSchema,
} from "@/proto/daemon/started_service_pb";

export class MockControl {
  offline = false;
  failNext = false;
  setOffline(value: boolean) {
    this.offline = value;
  }
  setFailNext(value: boolean) {
    this.failNext = value;
  }
  reset() {
    this.offline = false;
    this.failNext = false;
  }
}
const empty = () => create(EmptySchema);
export function createMockClient(control = new MockControl()): SingBoxClient {
  const boot = Date.now() - 8_040_000;
  let revision = 0;
  let count = 0;
  let mode = "rule";
  const groups = [
    create(GroupSchema, {
      tag: "Primary route",
      type: "selector",
      selectable: true,
      selected: "Tokyo 01",
      items: [
        ["Tokyo 01", "vless", 42],
        ["Singapore 01", "trojan", 68],
        ["Frankfurt 01", "shadowsocks", 168],
        ["Direct", "direct", 0],
      ].map(([tag, type, delayMs]) =>
        create(GroupItemSchema, {
          tag: String(tag),
          type: String(type),
          urlTestTime: delayMs ? BigInt(Math.floor(Date.now() / 1000)) : 0n,
          urlTestDelay: Number(delayMs),
        }),
      ),
    }),
    create(GroupSchema, {
      tag: "Auto route",
      type: "urltest",
      selectable: false,
      selected: "Singapore 01",
      items: [
        create(GroupItemSchema, {
          tag: "Singapore 01",
          type: "trojan",
          urlTestTime: BigInt(Math.floor(Date.now() / 1000)),
          urlTestDelay: 68,
        }),
        create(GroupItemSchema, { tag: "London 01", type: "vless" }),
      ],
    }),
  ];
  const connections = new Map(
    Array.from({ length: 28 }, (_, i) => {
      const id = `mock-${i + 1}`;
      return [
        id,
        create(ConnectionSchema, {
          id,
          inbound: "mixed-in",
          inboundType: "mixed",
          network: i % 4 ? "tcp" : "udp",
          source: `127.0.0.1:${50000 + i}`,
          destination: `203.0.113.${i + 1}:443`,
          domain: [
            "api.github.com",
            "cdn.example.org",
            "docs.sagernet.org",
            "registry.npmjs.org",
          ][i % 4],
          protocol: i % 4 ? "tls" : "quic",
          outbound: i % 3 ? "Tokyo 01" : "Singapore 01",
          outboundType: "vless",
          createdAt: BigInt(Date.now() - i * 2300),
          uplinkTotal: BigInt(12000 * (i + 1)),
          downlinkTotal: BigInt(134000 * (i + 1)),
          chainList: ["Primary route", "Tokyo 01"],
          rule: "default",
        }),
      ];
    }),
  );
  const check = () => {
    if (control.offline)
      throw new ConnectError("Simulated offline", Code.Unavailable);
  };
  const mutation = async (signal?: AbortSignal) => {
    await delay(250, signal ?? new AbortController().signal);
    check();
    if (control.failNext) {
      control.failNext = false;
      throw new ConnectError("Simulated denial", Code.PermissionDenied);
    }
  };
  return {
    async getVersion() {
      check();
      return create(VersionSchema, { version: "1.14.0", apiVersion: 4 });
    },
    async getStartedAt() {
      check();
      return create(StartedAtSchema, { startedAt: BigInt(boot) });
    },
    async getDefaultLogLevel() {
      check();
      return create(DefaultLogLevelSchema, { level: LogLevel.INFO });
    },
    async *subscribeServiceStatus(_, opts) {
      const signal = opts?.signal ?? new AbortController().signal;
      while (!signal.aborted) {
        check();
        yield create(ServiceStatusSchema, {
          status: ServiceStatus_Type.STARTED,
        });
        await delay(1000, signal);
      }
    },
    async *subscribeStatus(request, opts) {
      const signal = opts?.signal ?? new AbortController().signal;
      const ms = Number(request.interval ?? 1_000_000_000n) / 1_000_000;
      let down = 2_400_000_000n,
        up = 680_000_000n;
      while (!signal.aborted) {
        check();
        count++;
        const downlink = BigInt(
          Math.round(
            ((19 + Math.sin(count * 0.55) * 5 + Math.sin(count * 1.4) * 2) *
              1e6 *
              ms) /
              1000,
          ),
        );
        const uplink = BigInt(
          Math.round(((3 + Math.sin(count * 0.8)) * 1e6 * ms) / 1000),
        );
        down += downlink;
        up += uplink;
        yield create(StatusSchema, {
          memory: 84_600_000n,
          goroutines: 78,
          connectionsIn: connections.size,
          connectionsOut: connections.size,
          trafficAvailable: true,
          downlink,
          uplink,
          downlinkTotal: down,
          uplinkTotal: up,
        });
        await delay(ms, signal);
      }
    },
    async *subscribeGroups(_, opts) {
      const signal = opts?.signal ?? new AbortController().signal;
      let seen = -1;
      while (!signal.aborted) {
        check();
        if (seen !== revision) {
          seen = revision;
          yield clone(GroupsSchema, create(GroupsSchema, { group: groups }));
        }
        await delay(150, signal);
      }
    },
    async selectOutbound(request, opts) {
      await mutation(opts?.signal);
      const group = groups.find((g) => g.tag === request.groupTag);
      if (
        !group?.selectable ||
        !group.items.some((i) => i.tag === request.outboundTag)
      )
        throw new ConnectError("Invalid selection", Code.InvalidArgument);
      group.selected = request.outboundTag ?? "";
      revision++;
      return empty();
    },
    async uRLTest(request, opts) {
      await mutation(opts?.signal);
      for (const group of groups)
        for (const item of group.items) {
          if (
            item.tag === request.outboundTag ||
            group.tag === request.outboundTag
          ) {
            item.urlTestDelay = 25 + ((item.tag.length * 7) % 110);
            item.urlTestTime = BigInt(Math.floor(Date.now() / 1000));
          }
        }
      revision++;
      return empty();
    },
    async *subscribeLog(_, opts) {
      const signal = opts?.signal ?? new AbortController().signal;
      let i = 0;
      const messages = [
        "\u001b[37mDEBUG\u001b[0m[16737] [\u001b[38;5;168m1679805080\u001b[0m 0ms] router: pre-match[0] inbound=[mixed-in tun-in] => sniff(500ms)",
        "core: sing-box 1.14.0 started",
        "inbound/mixed: accepted connection from 127.0.0.1",
        "outbound/vless[Tokyo 01]: connection to api.github.com:443",
        "dns: exchanged query for cdn.example.org",
        "urltest: Singapore 01 available, 68ms",
      ];
      while (!signal.aborted) {
        check();
        yield create(LogSchema, {
          reset: i === 0,
          messages: [
            {
              level: i % 9 === 8 ? LogLevel.WARN : LogLevel.INFO,
              message: messages[i++ % messages.length],
            },
          ],
        });
        await delay(1400, signal);
      }
    },
    async *subscribeConnections(request, opts) {
      const signal = opts?.signal ?? new AbortController().signal;
      let first = true;
      while (!signal.aborted) {
        check();
        yield clone(
          ConnectionEventsSchema,
          create(ConnectionEventsSchema, {
            reset: true,
            events: [...connections.values()].map((c) =>
              create(ConnectionEventSchema, {
                type: ConnectionEventType.CONNECTION_EVENT_NEW,
                id: c.id,
                connection: c,
              }),
            ),
          }),
        );
        if (!first)
          for (const c of connections.values()) {
            c.downlinkTotal += 25000n;
            c.uplinkTotal += 3000n;
          }
        first = false;
        await delay(
          Number(request.interval ?? 1_000_000_000n) / 1_000_000,
          signal,
        );
      }
    },
    async closeConnection(request, opts) {
      await mutation(opts?.signal);
      connections.delete(request.id ?? "");
      return empty();
    },
    async closeAllConnections(_, opts) {
      await mutation(opts?.signal);
      connections.clear();
      return empty();
    },
    async getClashModeStatus() {
      check();
      return create(ClashModeStatusSchema, {
        modeList: ["rule", "global", "direct"],
        currentMode: mode,
      });
    },
    async setClashMode(request, opts) {
      await mutation(opts?.signal);
      mode = request.mode ?? "rule";
      return empty();
    },
  };
}
