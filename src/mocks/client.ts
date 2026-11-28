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
  OutboundListSchema,
  DeprecatedWarningsSchema,
  NetworkQualityTestProgressSchema,
  STUNTestProgressSchema,
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
  ClashModeSchema,
  ClashModeStatusSchema,
  NotificationEventSchema,
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
  const initialTestTime = BigInt(Math.floor(Date.now() / 1000));
  let revision = 0;
  let count = 0;
  const modeList = [
    "Balanced",
    "Low latency",
    "Only direct when the primary route cannot reach the destination",
  ];
  let mode = modeList[0];
  let logGeneration = 0;
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
        ["Auto route", "urltest", 0],
      ].map(([tag, type, delayMs]) =>
        create(GroupItemSchema, {
          tag: String(tag),
          type: String(type),
          urlTestTime: delayMs ? initialTestTime : 0n,
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
          urlTestTime: initialTestTime,
          urlTestDelay: 68,
        }),
        create(GroupItemSchema, { tag: "London 01", type: "vless" }),
      ],
    }),
  ];
  const groupsByTag = new Map(groups.map((group) => [group.tag, group]));
  const independent = create(GroupItemSchema, {
    tag: "Independent direct",
    type: "direct",
  });
  const items = [...groups.flatMap((group) => group.items), independent];
  const connections = new Map(
    Array.from({ length: 28 }, (_, i) => {
      const id = `mock-${i + 1}`;
      const outbound = i % 3 ? "Tokyo 01" : "Singapore 01";
      return [
        id,
        create(ConnectionSchema, {
          id,
          inbound: "mixed-in",
          inboundType: "mixed",
          ipVersion: 4,
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
          outbound,
          outboundType: "vless",
          createdAt: BigInt(Date.now() - i * 2300),
          uplinkTotal: BigInt(12000 * (i + 1)),
          downlinkTotal: BigInt(134000 * (i + 1)),
          chainList: [outbound, "Primary route"],
          rule: "inbound=mixed-in",
        }),
      ];
    }),
  );
  for (const id of ["mock-closed-1", "mock-closed-2"]) {
    connections.set(
      id,
      create(ConnectionSchema, {
        ...connections.get("mock-1")!,
        id,
        closedAt: BigInt(Date.now() - 1000),
      }),
    );
  }
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
          connectionsIn: [...connections.values()].filter(
            (c) => c.closedAt === 0n,
          ).length,
          connectionsOut: [...connections.values()].filter(
            (c) => c.closedAt === 0n,
          ).length,
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
          const snapshot = clone(
            GroupsSchema,
            create(GroupsSchema, { group: groups }),
          );
          for (const item of snapshot.group.flatMap((group) => group.items)) {
            const group = groupsByTag.get(item.tag);
            const member = group?.items.find(
              (candidate) => candidate.tag === group.selected,
            );
            if (member) {
              item.urlTestDelay = member.urlTestDelay;
              item.urlTestTime = member.urlTestTime;
            }
          }
          yield snapshot;
        }
        await delay(150, signal);
      }
    },
    async *subscribeOutbounds(_, opts) {
      const signal = opts?.signal ?? new AbortController().signal;
      let seen = -1;
      while (!signal.aborted) {
        check();
        if (seen !== revision) {
          seen = revision;
          const unique = new Map(items.map((item) => [item.tag, item]));
          for (const group of groups) {
            const selected = unique.get(group.selected);
            unique.set(group.tag, create(GroupItemSchema, {
              tag: group.tag,
              type: group.type,
              urlTestTime: selected?.urlTestTime,
              urlTestDelay: selected?.urlTestDelay,
            }));
          }
          yield clone(OutboundListSchema, create(OutboundListSchema, {
            outbounds: [...unique.values()],
          }));
        }
        await delay(150, signal);
      }
    },
    async getDeprecatedWarnings(_, opts) {
      await delay(220, opts?.signal ?? new AbortController().signal);
      check();
      return create(DeprecatedWarningsSchema, {
        warnings: [
          {
            message: "Demo routine deprecation",
            description: "Example of a warning without an imminent removal.",
            deprecatedVersion: "1.14.0",
            scheduledVersion: "1.17.0",
            migrationLink: "https://sing-box.sagernet.org.invalid/migration/",
          },
          {
            message: "Demo deprecation warning",
            description: "Example of a warning reported by a sing-box core.",
            deprecatedVersion: "1.13.0",
            scheduledVersion: "1.15.0",
            migrationLink: "https://sing-box.sagernet.org/migration/",
            impending: true,
          },
        ],
      });
    },
    async *startNetworkQualityTest(request, opts) {
      const signal = opts?.signal ?? new AbortController().signal;
      for (let sample = 0; sample <= 10; sample++) {
        check();
        const finished = sample === 10;
        const phase = finished ? 3 : request.serial ? (sample < 5 ? 1 : 2) : 1 + sample % 2;
        const elapsedMs = BigInt(sample * 300);
        const downloadElapsed = request.serial ? BigInt(Math.min(sample, 5) * 300) : elapsedMs;
        const hasDownload = sample >= (request.serial ? 1 : 2);
        const hasUpload = sample >= (request.serial ? 6 : 3);
        yield create(NetworkQualityTestProgressSchema, {
          phase,
          downloadCapacity: hasDownload ? 18_000_000n + downloadElapsed * 4000n : 0n,
          uploadCapacity: hasUpload ? 4_000_000n + elapsedMs * 1100n : 0n,
          downloadRPM: hasDownload ? 610 : 0,
          uploadRPM: hasUpload ? 430 : 0,
          idleLatencyMs: 31,
          elapsedMs: finished ? 0n : elapsedMs,
          downloadCapacityAccuracy: sample >= 5 ? 2 : 0,
          uploadCapacityAccuracy: sample >= 8 ? 2 : 0,
          downloadRPMAccuracy: 1,
          uploadRPMAccuracy: 1,
          isFinal: finished,
        });
        if (!finished) await delay(300, signal);
      }
    },
    async *startSTUNTest(_, opts) {
      const signal = opts?.signal ?? new AbortController().signal;
      yield create(STUNTestProgressSchema, { phase: 0 });
      await delay(500, signal);
      check();
      yield create(STUNTestProgressSchema, {
        phase: 3,
        externalAddr: "203.0.113.24:42424",
        latencyMs: 48,
        natMapping: 2,
        natFiltering: 2,
        natTypeSupported: true,
        isFinal: true,
      });
    },
    async selectOutbound(request, opts) {
      await mutation(opts?.signal);
      const group = groupsByTag.get(request.groupTag ?? "");
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
      const tested = new Set([request.outboundTag ?? ""]);
      for (const tag of tested) {
        for (const member of groupsByTag.get(tag)?.items ?? []) {
          tested.add(member.tag);
        }
      }
      const testedAt = BigInt(Math.floor(Date.now() / 1000));
      for (const item of items) {
        if (tested.has(item.tag) && !groupsByTag.has(item.tag)) {
          item.urlTestDelay = 25 + ((item.tag.length * 7) % 110);
          item.urlTestTime = testedAt;
        }
      }
      revision++;
      return empty();
    },
    async *subscribeLog(_, opts) {
      const signal = opts?.signal ?? new AbortController().signal;
      let i = 0;
      let seenGeneration = logGeneration;
      const messages = [
        "\u001b[37mDEBUG\u001b[0m[16737] [\u001b[38;5;168m1679805080\u001b[0m 0ms] router: pre-match[0] inbound=[mixed-in tun-in] => sniff(500ms)",
        "core: sing-box 1.14.0 started",
        "inbound/mixed: accepted connection from 127.0.0.1",
        "outbound/vless[Tokyo 01]: connection to api.github.com:443",
        "dns: exchanged query for cdn.example.org",
        "urltest: Singapore 01 available, 68ms",
      ];
      const initial = [
        { level: LogLevel.DEBUG, message: messages[0] },
        { level: LogLevel.TRACE, message: "demo trace: route lookup" },
        ...messages.slice(1, 5).map((message) => ({
          level: LogLevel.INFO,
          message,
        })),
        { level: LogLevel.WARN, message: "demo warning: retrying a probe" },
        { level: LogLevel.ERROR, message: "demo error: simulated probe failure" },
      ];
      while (!signal.aborted) {
        check();
        const reset = i === 0 || seenGeneration !== logGeneration;
        seenGeneration = logGeneration;
        yield create(LogSchema, {
          reset,
          messages: reset
            ? (logGeneration > 0 ? [] : initial)
            : [
                {
                  level: i % messages.length === 0 ? LogLevel.DEBUG : LogLevel.INFO,
                  message: messages[i % messages.length],
                },
              ],
        });
        i++;
        await delay(1400, signal);
      }
    },
    async clearLogs(_, opts) {
      await mutation(opts?.signal);
      logGeneration++;
      return empty();
    },
    subscribeOpenConnectStatus() {
      throw new ConnectError("OpenConnect status requires a native instance", Code.Unimplemented);
    },
    subscribeOpenVPNStatus() {
      throw new ConnectError("OpenVPN status requires a native instance", Code.Unimplemented);
    },
    subscribeUSBIPServerStatus() {
      throw new ConnectError("USB/IP status requires a native instance", Code.Unimplemented);
    },
    async *subscribeNotifications(_, opts) {
      const signal = opts?.signal ?? new AbortController().signal;
      await delay(300, signal);
      check();
      yield create(NotificationEventSchema, {
        event: { case: "send", value: { identifier: "demo-event", typeID: 1, title: "Demo core notification" } },
      });
      await delay(500, signal);
      check();
      yield create(NotificationEventSchema, {
        event: { case: "cancel", value: { identifier: "demo-event", typeID: 1 } },
      });
      while (!signal.aborted) {
        await delay(2000, signal);
        check();
      }
    },
    async *subscribeConnections(request, opts) {
      const signal = opts?.signal ?? new AbortController().signal;
      let first = true;
      const previous = new Map<string, { closedAt: bigint; uplinkTotal: bigint; downlinkTotal: bigint }>();
      while (!signal.aborted) {
        check();
        const events = [...connections.values()].flatMap((c) => {
          const last = previous.get(c.id);
          previous.set(c.id, { closedAt: c.closedAt, uplinkTotal: c.uplinkTotal, downlinkTotal: c.downlinkTotal });
          if (!last) return [create(ConnectionEventSchema, {
            type: ConnectionEventType.CONNECTION_EVENT_NEW, id: c.id, connection: c,
          })];
          if (last.closedAt > 0n) return [];
          if (c.closedAt > 0n) return [create(ConnectionEventSchema, {
            type: ConnectionEventType.CONNECTION_EVENT_CLOSED, id: c.id, closedAt: c.closedAt, connection: c,
          })];
          return [create(ConnectionEventSchema, {
            type: ConnectionEventType.CONNECTION_EVENT_UPDATE,
            id: c.id,
            uplinkDelta: c.uplinkTotal - last.uplinkTotal,
            downlinkDelta: c.downlinkTotal - last.downlinkTotal,
          })];
        });
        yield clone(ConnectionEventsSchema, create(ConnectionEventsSchema, { reset: first, events }));
        if (!first)
          for (const c of connections.values()) {
            if (c.closedAt > 0n) continue;
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
      const row = connections.get(request.id ?? "");
      if (row && row.closedAt === 0n) row.closedAt = BigInt(Date.now());
      return empty();
    },
    async closeAllConnections(_, opts) {
      await mutation(opts?.signal);
      for (const row of connections.values())
        if (row.closedAt === 0n) row.closedAt = BigInt(Date.now());
      return empty();
    },
    async getClashModeStatus() {
      check();
      return create(ClashModeStatusSchema, {
        modeList,
        currentMode: mode,
      });
    },
    async *subscribeClashMode(_, opts) {
      const signal = opts?.signal ?? new AbortController().signal;
      let previous: string | undefined;
      while (!signal.aborted) {
        check();
        if (previous !== mode) {
          previous = mode;
          yield create(ClashModeSchema, { mode });
        }
        await delay(200, signal);
      }
    },
    async setClashMode(request, opts) {
      await mutation(opts?.signal);
      const next = request.mode ?? "";
      if (modeList.includes(next)) mode = next;
      return empty();
    },
  };
}
