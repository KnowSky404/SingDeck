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
  GroupSchema,
  ConnectionEventsSchema,
  ConnectionEventType,
  LogSchema,
  VersionSchema,
} from "@/proto/daemon/started_service_pb";
import { loadProfiles, saveProfiles } from "@/features/instances/profiles";

import {
  captureInventoryLatencyHistory,
  confirmedInventoryLatency,
  hasFreshLatency,
  inventoryLatencyHistory,
  latency,
  latencyTestWaves,
} from "@/features/proxies/latency";

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

  it("recognizes a valid changed delay within the same whole second", () => {
    const history = (urlTestTime: bigint, urlTestDelay: number) =>
      create(GroupItemSchema, { urlTestTime, urlTestDelay });
    const previous = history(2n, 42);
    expect(hasFreshLatency(previous, history(2n, 0))).toBe(true);
    expect(hasFreshLatency(previous, history(3n, 42))).toBe(true);
    expect(hasFreshLatency(previous, history(2n, 42))).toBe(false);
    expect(hasFreshLatency(previous, history(1n, 18))).toBe(false);
    expect(hasFreshLatency(previous, history(2n, -1))).toBe(false);
    expect(hasFreshLatency(history(0n, 0), history(0n, 42))).toBe(false);
  });

  it("tracks a selector's verified leaf instead of its inherited inventory history", () => {
    const first = create(GroupItemSchema, { tag: "first", type: "direct", urlTestTime: 2n, urlTestDelay: 42 });
    const second = create(GroupItemSchema, { tag: "second", type: "direct", urlTestTime: 2n, urlTestDelay: 63 });
    const selector = create(GroupItemSchema, { ...first, tag: "selector", type: "selector" });
    const auto = create(GroupItemSchema, { ...first, tag: "auto", type: "urltest" });
    const inventory = new Map<string, typeof first | undefined>(
      [first, second, selector, auto].map((item) => [item.tag, item]),
    );
    const selection = (leaf: typeof first) => new Map([
      [selector.tag, create(GroupSchema, {
        tag: selector.tag,
        type: selector.type,
        selected: auto.tag,
        items: [{ ...auto, urlTestTime: leaf.urlTestTime, urlTestDelay: leaf.urlTestDelay }],
      })],
      [auto.tag, create(GroupSchema, {
        tag: auto.tag,
        type: auto.type,
        selected: leaf.tag,
        items: [leaf],
      })],
    ]);
    const groups = selection(first);
    const before = inventoryLatencyHistory(selector.tag, inventory, groups);
    expect(before?.item).toBe(first);
    expect(before?.matchesReportedHistory).toBe(true);

    const updated = { ...first, urlTestDelay: 0 };
    const newerGroups = selection(updated);
    // Another measurement can already be visible in Groups when the request is sent.
    expect(inventoryLatencyHistory(selector.tag, inventory, newerGroups)).toMatchObject({
      path: before?.path, item: first, matchesReportedHistory: false,
    });

    // Inventory can publish the new selection's inherited history before Groups catches up.
    inventory.set(selector.tag, { ...selector, urlTestDelay: second.urlTestDelay });
    inventory.set(auto.tag, { ...auto, urlTestDelay: second.urlTestDelay });
    inventory.set(first.tag, updated);
    expect(hasFreshLatency(first, updated)).toBe(true);
    expect(inventoryLatencyHistory(selector.tag, inventory, groups)).toMatchObject({
      path: before?.path, item: updated, matchesReportedHistory: false,
    });

    const switched = inventoryLatencyHistory(selector.tag, inventory, selection(second));
    expect(switched?.item).toBe(second);
    expect(switched?.matchesReportedHistory).toBe(true);
    expect(switched?.path).not.toBe(before?.path);

    inventory.set(auto.tag, { ...auto, urlTestDelay: updated.urlTestDelay });
    inventory.set(selector.tag, { ...selector, urlTestTime: 1n, urlTestDelay: updated.urlTestDelay });
    expect(inventoryLatencyHistory(selector.tag, inventory, newerGroups)?.matchesReportedHistory).toBe(false);
    inventory.set(selector.tag, { ...selector, urlTestDelay: updated.urlTestDelay });
    expect(inventoryLatencyHistory(selector.tag, inventory, newerGroups)).toMatchObject({
      path: before?.path, item: updated, matchesReportedHistory: true,
    });

    inventory.set(first.tag, undefined);
    expect(inventoryLatencyHistory(selector.tag, inventory, groups)).toBeUndefined();
    expect(inventoryLatencyHistory(selector.tag, inventory)).toBeUndefined();
  });

  it("keeps every pre-dispatch sample and preserves confirmation across a stream retry", () => {
    const leaf = create(GroupItemSchema, {
      tag: "direct", type: "direct", urlTestTime: 2n, urlTestDelay: 10,
    });
    const seenInGroups = { ...leaf, urlTestDelay: 18 };
    const seenInAlias = { ...leaf, tag: "alias", type: "selector", urlTestDelay: 27 };
    const inventory = new Map([[leaf.tag, leaf], [seenInAlias.tag, seenInAlias]]);
    const alias = (item: typeof leaf) => create(GroupSchema, {
      tag: seenInAlias.tag, type: seenInAlias.type, selected: leaf.tag, items: [item],
    });
    const groups = new Map([
      [seenInAlias.tag, alias(leaf)],
      ["other", create(GroupSchema, { tag: "other", selected: "different", items: [seenInGroups] })],
    ]);
    const baseline = captureInventoryLatencyHistory(leaf.tag, inventory, [...inventory.values()], groups)!;
    expect(inventoryLatencyHistory(leaf.tag, inventory, groups)?.matchesReportedHistory).toBe(false);
    expect(new Set(baseline.samples.map((item) => item.urlTestDelay))).toEqual(new Set([10, 18, 27]));

    groups.delete("other");
    function publish(urlTestDelay: number, urlTestTime = leaf.urlTestTime) {
      const latest = { ...leaf, urlTestDelay, urlTestTime };
      inventory.set(leaf.tag, latest);
      inventory.set(seenInAlias.tag, { ...seenInAlias, urlTestDelay, urlTestTime });
      groups.set(seenInAlias.tag, alias(latest));
      return inventoryLatencyHistory(leaf.tag, inventory, groups);
    }
    expect(confirmedInventoryLatency(baseline, publish(18), false)).toBe(false);
    expect(confirmedInventoryLatency(baseline, publish(27), false)).toBe(false);
    expect(confirmedInventoryLatency(baseline, publish(39), false)).toBe(true);
    expect(confirmedInventoryLatency(baseline, publish(18, 3n), false)).toBe(true);

    inventory.set(leaf.tag, { ...leaf, urlTestDelay: 44 });
    const partial = inventoryLatencyHistory(leaf.tag, inventory, groups);
    expect(partial?.matchesReportedHistory).toBe(false);
    expect(confirmedInventoryLatency(baseline, partial, true)).toBe(true);
    expect(confirmedInventoryLatency(baseline, undefined, true)).toBe(true);
    const changed = inventoryLatencyHistory(seenInAlias.tag, inventory, groups);
    expect(confirmedInventoryLatency(baseline, changed, true)).toBe(false);
    expect(inventoryLatencyHistory(leaf.tag, inventory, new Map())?.matchesReportedHistory).toBe(true);
    expect(inventoryLatencyHistory(leaf.tag, inventory)).toBeUndefined();
  });

  it("rejects previously reported samples from aliases that join the resolved leaf", () => {
    const leaf = create(GroupItemSchema, {
      tag: "leaf", type: "direct", urlTestTime: 2n, urlTestDelay: 10,
    });
    const unrelated = create(GroupItemSchema, {
      tag: "unrelated", type: "direct", urlTestTime: 3n, urlTestDelay: 70,
    });
    const alias = create(GroupItemSchema, {
      tag: "switching group", type: "selector", urlTestTime: 2n, urlTestDelay: 18,
    });
    const group = (selected: typeof leaf) => create(GroupSchema, {
      tag: alias.tag, type: alias.type, selected: selected.tag, items: [selected],
    });
    const holder = (member: typeof alias) => create(GroupSchema, {
      tag: "other group", type: "selector", selected: unrelated.tag, items: [unrelated, member],
    });
    const inventory = new Map([leaf, unrelated, alias].map((item) => [item.tag, item]));
    const groups = new Map([
      [alias.tag, group(unrelated)],
      ["other group", holder({ ...alias, urlTestDelay: 19 })],
    ]);
    const baseline = captureInventoryLatencyHistory(leaf.tag, inventory, [...inventory.values()], groups)!;
    expect(baseline.samples).toEqual([leaf]);

    function publish(urlTestDelay: number) {
      const latest = { ...leaf, urlTestDelay };
      const aliasHistory = { ...alias, urlTestDelay };
      inventory.set(leaf.tag, latest);
      inventory.set(alias.tag, aliasHistory);
      groups.set(alias.tag, group(latest));
      groups.set("other group", holder(aliasHistory));
      const observed = inventoryLatencyHistory(leaf.tag, inventory, groups);
      expect(observed?.matchesReportedHistory).toBe(true);
      return observed;
    }
    expect(confirmedInventoryLatency(baseline, publish(18), false)).toBe(false);
    expect(confirmedInventoryLatency(baseline, publish(19), false)).toBe(false);
    expect(confirmedInventoryLatency(baseline, publish(22), false)).toBe(true);
  });

  it("paces overlapping groups and runs configured tests after default tests", () => {
    const group = (tag: string, type: string, items: string[]) =>
      create(GroupSchema, { tag, type, items: items.map((tag) => ({ tag })) });
    const groups = [
      group("primary", "selector", ["shared", "auto", "primary-only"]),
      group("auto", "urltest", ["shared", "auto-only"]),
      group("second-auto", "urltest", ["shared", "second-only"]),
      group("nested-parent", "urltest", ["nested-child"]),
      group(
        "nested-child",
        "urltest",
        Array.from({ length: 11 }, (_, index) => `nested-node-${index}`),
      ),
      group(
        "disjoint",
        "selector",
        Array.from({ length: 10 }, (_, index) => `node-${index}`),
      ),
    ];
    expect(
      latencyTestWaves(new Map(groups.map((group) => [group.tag, group]))),
    ).toEqual([
      { tags: ["primary"], windows: 1 },
      { tags: ["disjoint"], windows: 1 },
      { tags: ["auto"], windows: 1 },
      { tags: ["second-auto"], windows: 1 },
      { tags: ["nested-parent"], windows: 2 },
      { tags: ["nested-child"], windows: 2 },
    ]);
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
