import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  appendLogs,
  applyConnections,
  assertCompatible,
  LOG_LIMIT,
} from "@/api/state";
import {
  ConnectionSchema,
  GroupItemSchema,
  ConnectionEventsSchema,
  ConnectionEventType,
  LogSchema,
  VersionSchema,
} from "@/proto/daemon/started_service_pb";
import { loadProfiles, saveProfiles } from "@/features/instances/profiles";

import { latency } from "@/features/proxies/latency";

const batch = (
  events: Parameters<typeof create<typeof ConnectionEventsSchema>>[1],
) => create(ConnectionEventsSchema, events);
describe("native state semantics", () => {
  it("preserves a successful zero-ms probe and does not invent failure metadata", () => {
    expect(latency(create(GroupItemSchema))).toBe("No result");
    expect(
      latency(create(GroupItemSchema, { urlTestTime: 1n, urlTestDelay: 0 })),
    ).toBe("0 ms");
    expect(
      latency(create(GroupItemSchema, { urlTestTime: 1n, urlTestDelay: 42 })),
    ).toBe("42 ms");
    expect(
      latency(create(GroupItemSchema, { urlTestTime: 1n, urlTestDelay: -1 })),
    ).toBe("Invalid result");
  });

  it("resets connection snapshots, accumulates deltas and retains confirmed closed history", () => {
    let rows = applyConnections(
      new Map(),
      batch({
        reset: true,
        events: [
          {
            id: "a",
            connection: create(ConnectionSchema, {
              id: "a",
              uplinkTotal: 10n,
              downlinkTotal: 30n,
            }),
          },
          {
            id: "closed",
            connection: create(ConnectionSchema, {
              id: "closed",
              closedAt: 10n,
            }),
          },
        ],
      }),
    );
    expect(rows.size).toBe(2);
    rows = applyConnections(
      rows,
      batch({
        events: [
          {
            id: "a",
            type: ConnectionEventType.CONNECTION_EVENT_UPDATE,
            uplinkDelta: 4n,
            downlinkDelta: 5n,
          },
        ],
      }),
    );
    expect(rows.get("a")).toMatchObject({
      uplinkTotal: 14n,
      downlinkTotal: 35n,
      uplink: 4n,
    });
    rows = applyConnections(
      rows,
      batch({
        events: [
          {
            id: "a",
            type: ConnectionEventType.CONNECTION_EVENT_CLOSED,
            closedAt: 20n,
            connection: create(ConnectionSchema, {
              id: "a",
              uplinkTotal: 25n,
              downlinkTotal: 50n,
            }),
          },
        ],
      }),
    );
    expect(rows.get("a")).toMatchObject({
      closedAt: 20n,
      uplinkTotal: 25n,
      downlinkTotal: 50n,
      uplink: 0n,
    });
    expect(rows.get("closed")?.closedAt).toBe(10n);
    rows = applyConnections(
      rows,
      batch({
        events: [
          {
            id: "a",
            type: ConnectionEventType.CONNECTION_EVENT_UPDATE,
            uplinkDelta: 99n,
          },
        ],
      }),
    );
    expect(rows.get("a")?.uplinkTotal).toBe(25n);
    expect(
      applyConnections(
        new Map([["a", create(ConnectionSchema)]]),
        batch({ reset: true }),
      ).size,
    ).toBe(0);
  });
  it("bounds log count and message length and honors reset", () => {
    const sequence = { value: 0 };
    const logs = appendLogs(
      [],
      create(LogSchema, {
        messages: Array.from({ length: LOG_LIMIT + 5 }, (_, i) => ({
          message: String(i),
        })),
      }),
      sequence,
      100,
    );
    expect(logs).toHaveLength(LOG_LIMIT);
    expect(logs[0].message).toBe("5");
    const next = appendLogs(
      logs,
      create(LogSchema, {
        reset: true,
        messages: [{ message: "x".repeat(20000) }],
      }),
      sequence,
      200,
    );
    expect(next).toHaveLength(1);
    expect(next[0].message).toHaveLength(16384);
    expect(next[0].id).toBeGreaterThan(logs.at(-1)!.id);
  });
  it("gates unknown API versions and prerelease / old cores", () => {
    expect(() =>
      assertCompatible(
        create(VersionSchema, { version: "1.14.0", apiVersion: 4 }),
      ),
    ).not.toThrow();
    for (const [version, apiVersion] of [
      ["1.13.9", 4],
      ["1.14.0", 5],
      ["1.14.0-beta.1", 4],
      ["", 0],
    ] as const) {
      expect(() =>
        assertCompatible(create(VersionSchema, { version, apiVersion })),
      ).toThrow(/Unsupported API/);
    }
  });
  it("persists only validated profile fields and never tokens", () => {
    let saved = "";
    const storage = {
      getItem: () => saved,
      setItem: (_: string, v: string) => {
        saved = v;
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
    });
    saveProfiles([
      {
        id: "p",
        name: "VPS",
        mode: "native",
        endpoint: "https://api.example.org",
        tls: true,
        preferences: {
          intervalMs: 1000,
          windowSeconds: 60,
          autoReconnect: true,
        },
        ...{ token: "super-secret" },
      },
    ]);
    expect(saved).not.toContain("super-secret");
    expect(loadProfiles()[0].name).toBe("VPS");
    saved =
      '[{"id":"bad","mode":"native","name":"x","endpoint":"https://host/?token=secret"}]';
    expect(loadProfiles()[0].id).toBe("local");
  });
});
