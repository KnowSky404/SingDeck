import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { InstanceSession } from "@/api/session";
import { createMockClient, MockControl } from "@/mocks/client";
import { mockProfile } from "@/features/instances/profiles";
import {
  ConnectionSchema,
  ConnectionEventsSchema,
  ConnectionEventType,
  GroupsSchema,
  VersionSchema,
  StatusSchema,
  ServiceStatusSchema,
  ServiceStatus_Type,
  LogSchema,
  NotificationEventSchema,
} from "@/proto/daemon/started_service_pb";
import { CONNECTION_LIMIT } from "@/api/state";
import { delay, describeError } from "@/api/errors";

const sessions: InstanceSession[] = [];
function session(
  control = new MockControl(),
  client = createMockClient(control),
) {
  const s = new InstanceSession(client, mockProfile);
  sessions.push(s);
  return s;
}
afterEach(() => {
  sessions.forEach((s) => s.disconnect());
  sessions.length = 0;
  vi.useRealTimers();
});
describe("session lifecycle", () => {
  it("recovers mode discovery after a transient error without interrupting monitoring", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const probe = vi.spyOn(client, "getClashModeStatus")
      .mockRejectedValueOnce(new ConnectError("temporary", Code.Unavailable));
    const s = session(undefined, client);
    s.connect();
    await vi.advanceTimersByTimeAsync(500);
    expect(s.getSnapshot().capabilities.clashMode.status).toBe("error");
    expect(s.getSnapshot().phase).toBe("connected");
    await vi.advanceTimersByTimeAsync(1000);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(s.getSnapshot().capabilities.clashMode.status).toBe("supported");
    expect(s.getSnapshot().currentClashMode).toBe("Balanced");
    expect(s.getSnapshot().loaded.clashMode).toBeFalsy();
  });
  it("keeps the last live Clash Mode until the core confirms and cancels when the slot changes", async () => {
    vi.useFakeTimers();
    const setClashMode = vi.fn(async () => create(EmptySchema));
    const s = session(undefined, { ...createMockClient(), setClashMode });
    s.connect();
    await vi.advanceTimersByTimeAsync(500);
    s.setDetailChannel("clashMode");
    await vi.advanceTimersByTimeAsync(200);
    expect(s.getSnapshot().currentClashMode).toBe("Balanced");
    s.setInventoryEnabled(false);
    expect(s.getSnapshot().loaded.clashMode).toBe(true);
    const missing = await s.setClashMode("missing").catch((error: unknown) => ConnectError.from(error));
    expect(missing).toMatchObject({ code: Code.InvalidArgument });
    expect(setClashMode).not.toHaveBeenCalled();
    const confirmation = expect(s.setClashMode("Low latency"))
      .rejects.toMatchObject({ code: Code.DeadlineExceeded });
    await vi.advanceTimersByTimeAsync(400);
    expect(s.getSnapshot()).toMatchObject({ currentClashMode: "Balanced", changingClashMode: true });
    await vi.advanceTimersByTimeAsync(8000);
    await confirmation;
    expect(s.getSnapshot().changingClashMode).toBeUndefined();
    const canceled = expect(s.setClashMode("Low latency"))
      .rejects.toMatchObject({ code: Code.Canceled });
    s.setDetailChannel("outbounds");
    await canceled;
    await vi.advanceTimersByTimeAsync(200);
    expect(s.getSnapshot().loaded).toMatchObject({ connections: false, outbounds: true, clashMode: false });
    expect(s.getSnapshot().changingClashMode).toBeUndefined();
  });
  it("converts nanosecond intervals and byte deltas to rates, ignoring the first sample", async () => {
    vi.useFakeTimers();
    let interval = 0n;
    const client = createMockClient();
    const s = new InstanceSession(
      {
        ...client,
        async *subscribeStatus(request, options) {
          interval = BigInt(request.interval ?? 0);
          yield create(StatusSchema, {
            trafficAvailable: true,
            uplink: 9999n,
            downlink: 9999n,
          });
          await delay(2000, options!.signal!);
          yield create(StatusSchema, {
            trafficAvailable: true,
            uplink: 200n,
            downlink: 5000n,
          });
          await delay(100000, options!.signal!);
        },
      },
      {
        ...mockProfile,
        preferences: { ...mockProfile.preferences, intervalMs: 2000 },
      },
    );
    sessions.push(s);
    s.connect();
    await vi.advanceTimersByTimeAsync(300);
    expect(s.getSnapshot().runtime.samples[0]?.down).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2100);
    expect(interval).toBe(2_000_000_000n);
    expect(s.getSnapshot().runtime.samples.at(-1)).toMatchObject({ up: 100, down: 2500 });
  });
  it("redacts credentials before any page or log export can consume a received message", async () => {
    vi.useFakeTimers();
    const marker = "synthetic-log-marker";
    const pasted = `${marker} \t`;
    const client = createMockClient();
    const s = new InstanceSession(
      {
        ...client,
        async *subscribeLog(_, options) {
          yield create(LogSchema, {
            messages: [
              { message: `server echoed ${marker} twice: ${marker}` },
              { message: `server echoed ${pasted}` },
            ],
          });
          await delay(100000, options!.signal!);
        },
      },
      mockProfile,
      pasted,
    );
    sessions.push(s);
    s.connect();
    await vi.advanceTimersByTimeAsync(300);
    expect(s.getSnapshot().logs.map(({ message, text }) => [message, text])).toEqual([
      ["server echoed [redacted] twice: [redacted]", "server echoed [redacted] twice: [redacted]"],
      ["server echoed [redacted] \t", "server echoed [redacted] \t"],
    ]);
  });

  it("keeps the current logs until the core sends a reset after acknowledging clear", async () => {
    vi.useFakeTimers();
    const s = session();
    await expect(s.clearCoreLogs()).rejects.toMatchObject({
      code: Code.Unavailable,
    });
    s.connect();
    await vi.advanceTimersByTimeAsync(300);
    const original = s.getSnapshot().logs;
    expect(original.length).toBeGreaterThan(0);
    const request = s.clearCoreLogs();
    await vi.advanceTimersByTimeAsync(300);
    await request;
    expect(s.getSnapshot().logs).toEqual(original);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.getSnapshot().logs).toEqual([]);
  });

  it("connects, confirms node changes from subscriptions, and does not fake a rejected selection", async () => {
    vi.useFakeTimers();
    const control = new MockControl(),
      s = session(control);
    s.connect();
    await vi.advanceTimersByTimeAsync(400);
    expect(s.getSnapshot().phase).toBe("connected");
    const select = s.selectOutbound("Primary route", "Singapore 01");
    await vi.advanceTimersByTimeAsync(500);
    await select;
    expect(s.getSnapshot().groups?.[0].selected).toBe("Singapore 01");
    control.setFailNext(true);
    const failure = expect(
      s.selectOutbound("Primary route", "Tokyo 01"),
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
    await vi.advanceTimersByTimeAsync(500);
    await failure;
    expect(s.getSnapshot().groups?.[0].selected).toBe("Singapore 01");
  });
  it("reconnects streams after a transient outage and clears cached data on disconnect", async () => {
    vi.useFakeTimers();
    const control = new MockControl(),
      s = session(control);
    s.connect();
    await vi.advanceTimersByTimeAsync(1200);
    control.setOffline(true);
    await vi.advanceTimersByTimeAsync(1800);
    expect(s.getSnapshot().phase).toBe("reconnecting");
    control.setOffline(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.getSnapshot().phase).toBe("connected");
    expect(s.getSnapshot().streamErrors.status).toBeUndefined();
    s.disconnect();
    await vi.advanceTimersByTimeAsync(10000);
    expect(s.getSnapshot()).toMatchObject({ phase: "disconnected", logs: [] });
    expect(s.getSnapshot().connections.size).toBe(0);
    expect(s.getSnapshot().groups).toBeUndefined();
  });
  it("shares the detail subscription and ignores native data after leaving the notification page", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const connections = vi.fn(client.subscribeConnections);
    const notifications = vi.fn<typeof client.subscribeNotifications>(async function* () {
      yield create(NotificationEventSchema, {
        event: { case: "send", value: { identifier: "taildrop/peer/password=reset.txt", typeID: 1, title: "Live message" } },
      });
      await delay(2000, new AbortController().signal);
      yield create(NotificationEventSchema, {
        event: { case: "send", value: { identifier: "late", typeID: 1, title: "Late message" } },
      });
    });
    const s = session(undefined, { ...client, subscribeConnections: connections, subscribeNotifications: notifications });
    s.connect();
    await vi.advanceTimersByTimeAsync(400);
    expect(notifications).not.toHaveBeenCalled();
    expect(connections.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(false);
    expect(s.getSnapshot().notifications).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "configuration" })]));
    s.setDetailChannel("notifications");
    expect(connections.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(notifications).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot().notifications[0]).toMatchObject({ source: "native", title: "Live message" });
    expect(s.getSnapshot().notifications[0].id).toMatch(/^native:\d+$/);
    expect(JSON.stringify(s.getSnapshot().notifications)).not.toContain("password=reset.txt");
    s.setDetailChannel("connections");
    expect(notifications.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(2100);
    expect(s.getSnapshot().loaded.connections).toBe(true);
    expect(s.getSnapshot().notifications.filter((entry) => entry.source === "native")).toHaveLength(1);
    s.disconnect();
    expect(s.getSnapshot().notifications).toHaveLength(0);
    expect(session().getSnapshot().notifications).toHaveLength(0);
  });
  it("shows a quiet native retry as awaiting an event", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    let attempts = 0;
    const s = session(undefined, {
      ...client,
      async *subscribeNotifications(_, options) {
        if (++attempts === 1) throw new ConnectError("temporary", Code.Unavailable);
        await delay(60_000, options!.signal!);
        yield create(NotificationEventSchema, {
          event: { case: "send", value: { identifier: "after-idle", title: "After the quiet period" } },
        });
      },
    });
    s.connect();
    await vi.advanceTimersByTimeAsync(400);
    s.setDetailChannel("notifications");
    await vi.advanceTimersByTimeAsync(100);
    expect(s.getSnapshot().streamErrors.notifications).toBeDefined();
    await vi.advanceTimersByTimeAsync(1100);
    expect(attempts).toBe(2);
    expect(s.getSnapshot().streamErrors.notifications).toBeUndefined();
    expect(s.getSnapshot().loaded.notifications).toBe(false);
  });
  it("bounds connection history and evicts closed records before active connections", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const closeConnection = vi.fn(client.closeConnection);
    const s = session(new MockControl(), {
      ...client,
      closeConnection,
      async *subscribeConnections(_, options) {
        yield create(ConnectionEventsSchema, {
          reset: true,
          events: [
            ...Array.from({ length: CONNECTION_LIMIT }, (_, i) => ({
              id: `active-${i}`,
              connection: create(ConnectionSchema, { id: `active-${i}` }),
            })),
            {
              id: "closed-1",
              connection: create(ConnectionSchema, {
                id: "closed-1",
                closedAt: 1n,
              }),
            },
            {
              id: "closed-2",
              connection: create(ConnectionSchema, {
                id: "closed-2",
                closedAt: 2n,
              }),
            },
          ],
        });
        await delay(60_000, options!.signal!);
      },
    });
    s.connect();
    await vi.advanceTimersByTimeAsync(500);
    const snapshot = s.getSnapshot();
    expect(snapshot.connections.size).toBe(CONNECTION_LIMIT);
    expect(snapshot.connections.has("active-0")).toBe(true);
    expect(snapshot.connections.has("closed-1")).toBe(false);
    expect(snapshot.connectionOverflow).toBe(true);
    expect(snapshot.serviceActionsReady).toBe(true);
    await expect(s.closeConnectionBatch({ ...snapshot, ids: ["active-0"] })).resolves.toMatchObject({ unsent: 1 });
    expect(closeConnection).not.toHaveBeenCalled();
  });
  it("does not close all from a published view that still shows stale active rows", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const closeAllConnections = vi.fn().mockResolvedValue(create(EmptySchema));
    const s = session(new MockControl(), {
      ...client,
      closeAllConnections,
      async *subscribeConnections(_, options) {
        const signal = options!.signal!;
        yield create(ConnectionEventsSchema, {
          reset: true,
          events: [{ id: "active", connection: create(ConnectionSchema, { id: "active" }) }],
        });
        await delay(500, signal);
        yield create(ConnectionEventsSchema, { reset: true });
        await delay(60_000, signal);
      },
    });
    s.connect();
    await vi.advanceTimersByTimeAsync(300);
    expect(s.getSnapshot().loaded.connections).toBe(true);
    expect(s.getSnapshot().connections.has("active")).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(s.getSnapshot().connections.has("active")).toBe(true);
    await expect(s.closeAllConnections().catch(describeError)).resolves.toBe("No active connections remain.");
    s.setInventoryEnabled(true);
    await expect(s.closeAllConnections().catch(describeError)).resolves.toBe("Wait for the connection list to refresh, then try again.");
    expect(closeAllConnections).not.toHaveBeenCalled();
  });
  it("closes only selected active IDs in order and reports partial acknowledgements", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const closeConnection = vi.fn<typeof client.closeConnection>(async ({ id }, options) => {
      if (id === "rejected") throw new ConnectError("private-error-detail", Code.PermissionDenied);
      await delay(200, options!.signal!);
      return create(EmptySchema);
    });
    const closeAllConnections = vi.fn(client.closeAllConnections);
    const ids = ["first", "closing", "rejected", "unsent"];
    const s = session(undefined, {
      ...client, closeConnection, closeAllConnections,
      async *subscribeConnections(_, options) {
        const signal = options!.signal!;
        yield create(ConnectionEventsSchema, {
          reset: true,
          events: ids.map((id) => ({ id, connection: create(ConnectionSchema, { id }) })),
        });
        await delay(500, signal);
        yield create(ConnectionEventsSchema, {
          events: [
            { id: "closing", type: ConnectionEventType.CONNECTION_EVENT_CLOSED, closedAt: 1n },
            { id: "new-match", connection: create(ConnectionSchema, { id: "new-match" }) },
          ],
        });
        await delay(60_000, signal);
      },
    });
    s.connect();
    await vi.advanceTimersByTimeAsync(400);
    const batch = s.closeConnectionBatch({ ...s.getSnapshot(), ids });
    expect(closeConnection.mock.calls.map(([request]) => request.id)).toEqual(["first"]);
    await vi.advanceTimersByTimeAsync(250);
    await expect(batch).resolves.toEqual({
      acknowledged: 1, skipped: 1, unacknowledged: 1, unsent: 1,
      error: "This instance denied access. Check its access policy.",
    });
    expect(closeConnection.mock.calls.map(([request]) => request.id)).toEqual(["first", "rejected"]);
    expect(closeAllConnections).not.toHaveBeenCalled();
    expect(s.getSnapshot().connections.get("first")?.closedAt).toBe(0n);
    expect(s.getSnapshot().connections.has("new-match")).toBe(true);
  });
  it.each(["caller cancellation", "disconnect", "connection reset", "detail slot change"])("cancels a pending request on %s", async (stop) => {
    vi.useFakeTimers();
    const client = createMockClient();
    const closeConnection = vi.fn<typeof client.closeConnection>(async (_, options) => {
      await delay(10_000, options!.signal!);
      return create(EmptySchema);
    });
    const ids = ["first", "second"];
    const s = session(undefined, {
      ...client, closeConnection,
      async *subscribeConnections(_, options) {
        const signal = options!.signal!;
        const snapshot = create(ConnectionEventsSchema, {
          reset: true,
          events: ids.map((id) => ({ id, connection: create(ConnectionSchema, { id }) })),
        });
        yield snapshot;
        if (stop === "connection reset") {
          await delay(500, signal);
          yield snapshot;
        }
        await delay(60_000, signal);
      },
    });
    s.connect();
    await vi.advanceTimersByTimeAsync(400);
    const selection = { ...s.getSnapshot(), ids };
    const caller = new AbortController();
    const result = s.closeConnectionBatch(selection, caller.signal);
    expect(closeConnection).toHaveBeenCalledTimes(1);
    if (stop === "caller cancellation") caller.abort();
    else if (stop === "disconnect") s.disconnect();
    else if (stop === "detail slot change") s.setDetailChannel("clashMode");
    else await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toMatchObject({ acknowledged: 0, unacknowledged: 1, unsent: 1 });
    expect(closeConnection.mock.calls[0][1]?.signal?.aborted).toBe(true);
    if (stop === "connection reset") {
      expect(s.getSnapshot().connectionGeneration).toBe(selection.connectionGeneration);
      await expect(s.closeConnectionBatch(selection)).resolves.toMatchObject({ unsent: 2 });
    }
    expect(closeConnection).toHaveBeenCalledTimes(1);
  });
  it("rechecks API compatibility after an outage and stops incompatible streams", async () => {
    vi.useFakeTimers();
    const control = new MockControl();
    const client = createMockClient(control);
    let apiVersion = 4;
    const getVersion = vi.fn(async () => ({
      ...(await client.getVersion({})),
      apiVersion,
    }));
    const s = session(control, { ...client, getVersion });
    s.connect();
    await vi.advanceTimersByTimeAsync(500);
    control.setOffline(true);
    await vi.advanceTimersByTimeAsync(1000);
    apiVersion = 5;
    control.setOffline(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(getVersion.mock.calls.length).toBeGreaterThan(1);
    expect(s.getSnapshot().phase).toBe("error");
    expect(s.getSnapshot().error).toContain("Unsupported API");
    expect(s.signal?.aborted).toBe(true);
  });
  it("does not retry authentication failures", async () => {
    vi.useFakeTimers();
    const client = createMockClient(),
      getVersion = vi
        .fn()
        .mockRejectedValue(new ConnectError("secret", Code.Unauthenticated));
    const s = session(undefined, { ...client, getVersion });
    s.connect();
    await vi.advanceTimersByTimeAsync(10000);
    expect(getVersion).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot().phase).toBe("error");
    expect(s.getSnapshot().error).not.toContain("secret");
  });
  it("reports a subscription rejecting authentication while status remains available", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const s = session(undefined, {
      ...client,
      async *subscribeGroups() {
        yield create(GroupsSchema);
        throw new ConnectError("Authentication rejected", Code.Unauthenticated);
      },
    });
    s.connect();
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.getSnapshot()).toMatchObject({
      phase: "connected",
      authenticationFailed: true,
    });
  });
  it("reports authentication rejected by an action while status stays connected", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const s = session(undefined, {
      ...client,
      closeConnection: vi
        .fn()
        .mockRejectedValue(
          new ConnectError("Authentication rejected", Code.Unauthenticated),
        ),
    });
    s.connect();
    await vi.advanceTimersByTimeAsync(500);
    await expect(s.closeConnection("active")).rejects.toMatchObject({
      code: Code.Unauthenticated,
    });
    expect(s.getSnapshot()).toMatchObject({
      phase: "connected",
      authenticationFailed: true,
    });
  });
  it("ignores late responses from a canceled handshake", async () => {
    vi.useFakeTimers();
    let release!: (v: ReturnType<typeof create<typeof VersionSchema>>) => void;
    const client = createMockClient(),
      s = session(undefined, {
        ...client,
        getVersion: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      });
    s.connect();
    s.disconnect();
    release(create(VersionSchema, { version: "1.14.0", apiVersion: 4 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.getSnapshot().version).toBeUndefined();
    expect(s.getSnapshot().phase).toBe("disconnected");
  });
  it("times out node changes when the server never confirms them", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const s = session(undefined, {
      ...client,
      async *subscribeGroups(_, options) {
        yield create(GroupsSchema);
        await delay(100000, options!.signal!);
      },
    });
    s.connect();
    await vi.advanceTimersByTimeAsync(300);
    const failure = expect(
      s.selectOutbound("Primary route", "Singapore 01"),
    ).rejects.toMatchObject({ code: Code.DeadlineExceeded });
    await vi.advanceTimersByTimeAsync(9000);
    await failure;
  });

  it("paces native latency batches and cancels queued probes on disconnect", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const uRLTest = vi.fn(client.uRLTest);
    const s = new InstanceSession(
      { ...client, uRLTest },
      { ...mockProfile, mode: "native" },
    );
    sessions.push(s);
    s.connect();
    await vi.advanceTimersByTimeAsync(300);
    const tags = Array.from({ length: 21 }, (_, index) => `node-${index}`);
    const waves = [tags.slice(0, 10), tags.slice(10, 20), tags.slice(20)].map(
      (tags) => ({ tags, windows: 1 }),
    );
    const running = s.testLatencies(waves);
    const canceled = expect(running).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(s.testLatencies(waves)).toBe(running);
    expect(s.getSnapshot().testingLatencies).toBe(true);
    await vi.advanceTimersByTimeAsync(15_499);
    expect(uRLTest).toHaveBeenCalledTimes(10);
    await vi.advanceTimersByTimeAsync(1);
    expect(uRLTest).toHaveBeenCalledTimes(20);
    s.disconnect();
    await canceled;
    await vi.advanceTimersByTimeAsync(15_250);
    expect(uRLTest).toHaveBeenCalledTimes(20);
    expect(s.getSnapshot().testingLatencies).toBeUndefined();
  });

  it("keeps manual tests responsive while guarding bulk dispatch", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const uRLTest = vi.fn(client.uRLTest).mockRejectedValueOnce(
      new ConnectError("Response unavailable", Code.Unavailable),
    );
    const s = new InstanceSession(
      { ...client, uRLTest },
      { ...mockProfile, mode: "native" },
    );
    sessions.push(s);
    s.connect();
    await vi.advanceTimersByTimeAsync(300);
    await expect(s.testLatency("Direct", 1)).rejects.toMatchObject({
      code: Code.Unavailable,
    });
    expect(s.getSnapshot().testingManualLatencies).toEqual(new Set(["Direct"]));
    await expect(s.testLatencies([{ tags: ["Primary route"], windows: 1 }]))
      .rejects.toMatchObject({ code: Code.Canceled });
    const second = s.testLatency("London 01", 1);
    await vi.advanceTimersByTimeAsync(250);
    await second;
    expect(s.getSnapshot().testingManualLatencies).toEqual(new Set(["Direct", "London 01"]));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.getSnapshot().testingManualLatencies).toEqual(new Set(["London 01"]));
    await vi.advanceTimersByTimeAsync(250);
    expect(s.getSnapshot().testingManualLatencies).toBeUndefined();
    uRLTest.mockRejectedValueOnce(new ConnectError("Missing group", Code.NotFound));
    await expect(s.testLatency("Missing group", 10)).rejects.toMatchObject({
      code: Code.NotFound,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getSnapshot().testingManualLatencies).toBeUndefined();
  });

  it("keeps the running wave's cooldown across group stream recovery", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const uRLTest = vi.fn(client.uRLTest);
    let attempts = 0;
    const s = new InstanceSession(
      {
        ...client,
        uRLTest,
        async *subscribeGroups(_, options) {
          yield create(GroupsSchema);
          if (++attempts === 1) {
            await delay(1000, options!.signal!);
            throw new ConnectError("Groups interrupted", Code.Unavailable);
          }
          await delay(30_000, options!.signal!);
        },
      },
      { ...mockProfile, mode: "native" },
    );
    sessions.push(s);
    s.connect();
    await vi.advanceTimersByTimeAsync(300);
    const canceled = expect(
      s.testLatencies([
        { tags: ["Primary route"], windows: 1 },
        { tags: ["Auto route"], windows: 1 },
      ]),
    ).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.getSnapshot().streamErrors.groups).toBeUndefined();
    expect(s.getSnapshot().testingLatencies).toBe(true);
    await vi.advanceTimersByTimeAsync(12_500);
    await canceled;
    expect(uRLTest).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot().testingLatencies).toBeUndefined();
  });

  it("stops queued latency probes when the instance denies access", async () => {
    vi.useFakeTimers();
    const uRLTest = vi.fn().mockRejectedValue(new ConnectError("Denied", Code.PermissionDenied));
    const s = session(undefined, { ...createMockClient(), uRLTest });
    s.connect();
    await vi.advanceTimersByTimeAsync(300);
    await expect(s.testLatencies([
      { tags: ["Primary route"], windows: 1 },
      { tags: ["Auto route"], windows: 1 },
    ])).rejects.toMatchObject({ code: Code.PermissionDenied });
    expect(uRLTest).toHaveBeenCalledTimes(1);
  });

  it.each([
    { history: 1n, update: "none", calls: 2 },
    { history: 1n, update: "latency", calls: 1 },
    { history: 1n, update: "members", calls: 1 },
    { history: 1n, update: "mixed", calls: 2 },
    { history: 1n, update: "mixed-latency", calls: 1 },
    { history: 0n, update: "none", calls: 1 },
  ])(
    "makes $calls automatic group requests with history $history and update $update",
    async ({ history, update, calls }) => {
      vi.useFakeTimers();
      const client = createMockClient();
      const uRLTest = vi.fn(client.uRLTest);
      const groups = (urlTestDelay: number, extra?: string) =>
        create(GroupsSchema, {
          group: [
            {
              tag: "Auto route",
              type: "urltest",
              items: [
                { tag: "London 01", urlTestTime: history, urlTestDelay },
                ...(extra ? [{ tag: extra }] : []),
              ],
            },
          ],
        });
      const s = new InstanceSession(
        {
          ...client,
          uRLTest,
          async *subscribeGroups(_, options) {
            const mixed = update.startsWith("mixed");
            yield groups(
              history ? 20 : 0,
              mixed ? "Tokyo 01" : update === "members" ? "London 01" : undefined,
            );
            if (update.endsWith("latency") || update === "members") {
              await delay(1000, options!.signal!);
              yield groups(
                update === "members" ? 20 : 21,
                mixed || update === "members" ? "Tokyo 01" : undefined,
              );
            }
            await delay(60_000, options!.signal!);
          },
        },
        { ...mockProfile, mode: "native" },
      );
      sessions.push(s);
      s.connect();
      await vi.advanceTimersByTimeAsync(300);
      const waves = [{ tags: ["Auto route"], windows: 1 }];
      if (update === "members") waves.push({ tags: ["Auto route"], windows: 1 });
      const run = s.testLatencies(waves);
      const outcome = update === "members"
        ? expect(run).rejects.toMatchObject({ code: Code.Canceled })
        : run;
      await vi.advanceTimersByTimeAsync(32_000);
      await outcome;
      expect(uRLTest).toHaveBeenCalledTimes(calls);
    },
  );

  it("refreshes groups and cancels a manual probe after the service restarts", async () => {
    vi.useFakeTimers();
    let groupsStreams = 0;
    const groups = (tag: string) => create(GroupsSchema, { group: [{ tag }] });
    const client = createMockClient();
    const s = session(undefined, {
      ...client,
      async *subscribeServiceStatus(_, options) {
        const signal = options!.signal!;
        yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
        await delay(2000, signal);
        yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STOPPING });
        await delay(100, signal);
        yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
        await delay(60_000, signal);
      },
      async *subscribeGroups(_, options) {
        const signal = options!.signal!;
        if (++groupsStreams === 1) {
          yield groups("old");
          await delay(1000, signal);
        }
        yield groups("fresh");
        await delay(60_000, signal);
      },
      uRLTest: async (_, options) => {
        await delay(10_000, options!.signal!);
        return client.uRLTest({}, options);
      },
    });
    s.connect();
    await vi.advanceTimersByTimeAsync(300);
    const canceled = expect(s.testLatency("old", 1)).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(2000);
    await canceled;
    expect(groupsStreams).toBe(2);
    expect(s.getSnapshot().groups?.map(({ tag }) => tag)).toEqual(["fresh"]);
  });
});
