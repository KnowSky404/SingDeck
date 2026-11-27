import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { expect, it, vi } from "vitest";
import { delay } from "@/api/errors";
import { notificationStreamState, recordRuntimeEvent, recordRuntimeSample } from "@/api/runtime";
import { InstanceSession } from "@/api/session";
import { initialSnapshot } from "@/api/state";
import { mockProfile } from "@/features/instances/profiles";
import { createMockClient } from "@/mocks/client";
import {
  ServiceStatusSchema,
  ServiceStatus_Type,
  StartedAtSchema,
  StatusSchema,
} from "@/proto/daemon/started_service_pb";

it("reports notification observation status without treating a quiet stream as live", () => {
  const snapshot = initialSnapshot();
  expect(notificationStreamState(snapshot, false)).toBe("Disconnected");
  snapshot.phase = "connected";
  expect(notificationStreamState(snapshot, false)).toBe("Inactive");
  snapshot.detailChannel = "notifications";
  expect(notificationStreamState(snapshot, false)).toBe("Awaiting event");
  snapshot.loaded.notifications = true;
  snapshot.capabilities.notifications = { status: "supported" };
  expect(notificationStreamState(snapshot, false)).toBe("Event received");
  snapshot.streamErrors.notifications = "Stream ended";
  expect(notificationStreamState(snapshot, false)).toBe("Interrupted");
  snapshot.detailChannel = "connections";
  expect(notificationStreamState(snapshot, false)).toBe("Inactive");
  snapshot.capabilities.notifications = { status: "unsupported" };
  expect(notificationStreamState(snapshot, false)).toBe("Unavailable");
});

it("bounds observations and keeps outbound counts independent of traffic tracking", () => {
  const status = create(StatusSchema, { memory: 1024n, goroutines: 11, connectionsOut: 3 });
  let runtime = initialSnapshot().runtime;
  for (let index = 0; index < 310; index++) {
    runtime = recordRuntimeSample(runtime, status, index * 1000, true, false);
    runtime = recordRuntimeEvent(runtime, { time: index * 1000, kind: "status-resumed" });
  }
  expect(runtime.samples).toHaveLength(300);
  expect(runtime.events).toHaveLength(60);
  expect(runtime.samples.at(-1)).toEqual({
    time: 309_000,
    memory: 1024n,
    goroutines: 11,
    connectionsIn: undefined,
    connectionsOut: 3,
    up: undefined,
    down: undefined,
    gapBefore: false,
  });
  const afterGap = recordRuntimeSample(runtime, status, 700_000, false, true);
  expect(afterGap.samples).toHaveLength(1);
  expect(afterGap.samples[0]).toMatchObject({ connectionsOut: 3, gapBefore: true });
});

it("uses sample order instead of timestamps or retained events to establish restart freshness", () => {
  const status = create(StatusSchema);
  const time = 1000;
  let runtime = initialSnapshot().runtime;
  runtime = recordRuntimeSample(runtime, status, time, true, false);
  const restart = { time, kind: "restart", startedAt: 20_000n } as const;
  runtime = recordRuntimeEvent(runtime, restart);
  expect(runtime.events).toEqual([restart]);
  expect(runtime.awaitingPostRestartSample).toBe(true);
  for (let index = 0; index < 60; index++) {
    runtime = recordRuntimeEvent(runtime, { time, kind: "status-resumed" });
  }
  expect(runtime.events).toHaveLength(60);
  expect(runtime.events).not.toContain(restart);
  expect(runtime.awaitingPostRestartSample).toBe(true);
  runtime = recordRuntimeSample(runtime, status, time, true, true);
  expect(runtime.samples.map((sample) => sample.time)).toEqual([time, time]);
  expect(runtime.awaitingPostRestartSample).toBe(false);
});

it("clears older samples while retaining a status frame still pending publication", async () => {
  vi.useFakeTimers();
  const client = createMockClient();
  const statuses = Array.from({ length: 4 }, (_, index) => create(StatusSchema, {
    memory: BigInt(index + 1) * 1024n,
    trafficAvailable: true,
    uplink: 50n,
    downlink: 100n,
    uplinkTotal: BigInt(index + 1) * 50n,
    downlinkTotal: BigInt(index + 1) * 100n,
  }));
  const receipts: number[] = [];
  const statusStream = vi.spyOn(client, "subscribeStatus").mockImplementation(async function* (_, options) {
    for (const status of statuses) {
      receipts.push(Date.now());
      yield status;
      await delay(1000, options!.signal!);
    }
    await delay(60_000, options!.signal!);
  });
  const serviceStream = vi.spyOn(client, "subscribeServiceStatus").mockImplementation(async function* (_, options) {
    yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
    await delay(60_000, options!.signal!);
  });
  const logStream = vi.spyOn(client, "subscribeLog");
  const groupsStream = vi.spyOn(client, "subscribeGroups");
  const connectionsStream = vi.spyOn(client, "subscribeConnections");
  const session = new InstanceSession(client, mockProfile);
  const publish = vi.fn();
  const unsubscribe = session.subscribe(publish);
  try {
    const empty = session.getSnapshot();
    session.clearOlderRuntimeSamples();
    expect(session.getSnapshot()).toBe(empty);
    expect(publish).not.toHaveBeenCalled();

    session.connect();
    await vi.advanceTimersByTimeAsync(300);
    const one = session.getSnapshot();
    expect(one.runtime.samples).toHaveLength(1);
    publish.mockClear();
    session.clearOlderRuntimeSamples();
    expect(session.getSnapshot()).toBe(one);
    expect(publish).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1699);
    const before = session.getSnapshot();
    expect(before.runtime.samples).toHaveLength(2);
    expect(before.status).toBe(statuses[1]);
    expect(before.runtime.lastFrameAt.status).toBe(receipts[1]);
    expect(before.runtime.lastBoot).toBeDefined();
    expect(before.runtime.events).not.toHaveLength(0);

    publish.mockClear();
    await vi.advanceTimersByTimeAsync(2);
    expect(receipts).toHaveLength(3);
    expect(session.getSnapshot()).toBe(before);
    const signal = session.signal;
    const streams = [statusStream, serviceStream, logStream, groupsStream, connectionsStream];
    const streamCalls = streams.map(stream => stream.mock.calls.length);
    const streamSignals = streams.map(stream => stream.mock.calls[0]?.[1]?.signal);
    session.clearOlderRuntimeSamples();
    const cleared = session.getSnapshot();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(cleared.runtime.samples).toEqual([expect.objectContaining({
      time: receipts[2], memory: 3072n, up: 50, down: 100, gapBefore: false,
    })]);
    expect(cleared.status).toBe(statuses[2]);
    expect(cleared.runtime.lastFrameAt.status).toBe(receipts[2]);
    expect(cleared.runtime.lastFrameAt.service).toBe(before.runtime.lastFrameAt.service);
    expect(cleared.runtime.lastFrameAt.logs).toBe(before.runtime.lastFrameAt.logs);
    expect(cleared.runtime.events).toBe(before.runtime.events);
    expect(cleared.runtime.lastBoot).toBe(before.runtime.lastBoot);
    expect(cleared.startedAt).toBe(before.startedAt);
    expect(cleared.service).toBe(before.service);
    expect(cleared.phase).toBe("connected");
    expect(cleared.streamErrors).toEqual(before.streamErrors);
    expect(cleared.loaded).toEqual(before.loaded);
    expect(session.signal).toBe(signal);
    expect(signal?.aborted).toBe(false);
    expect(streamCalls).toEqual([1, 1, 1, 1, 1]);
    expect(streams.map(stream => stream.mock.calls.length)).toEqual(streamCalls);
    expect(streamSignals.every(signal => signal?.aborted === false)).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(publish).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    const later = session.getSnapshot();
    expect(later.runtime.samples.map(sample => sample.time)).toEqual(receipts.slice(2));
    expect(later.runtime.samples[0]).toBe(cleared.runtime.samples[0]);
    expect(later.runtime.samples[1]).toMatchObject({ memory: 4096n, up: 50, down: 100 });
    expect(later.runtime.lastFrameAt.status).toBe(receipts[3]);
    expect(streams.map(stream => stream.mock.calls.length)).toEqual(streamCalls);
    session.clearOlderRuntimeSamples();
    expect(session.getSnapshot().runtime.samples[0]).toBe(later.runtime.samples[1]);
  } finally {
    unsubscribe();
    session.disconnect();
    vi.useRealTimers();
  }
});

it("leaves an unreported outbound count unknown after lifecycle stream failure", async () => {
  vi.useFakeTimers();
  const client = createMockClient();
  vi.spyOn(client, "subscribeServiceStatus").mockImplementation(async function* (_, options) {
    yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
    await delay(700, options!.signal!);
    throw new ConnectError("service denied", Code.PermissionDenied);
  });
  vi.spyOn(client, "subscribeStatus").mockImplementation(async function* (_, options) {
    const signal = options!.signal!;
    while (!signal.aborted) {
      yield create(StatusSchema, { connectionsOut: 0 });
      await delay(1000, signal);
    }
  });
  const session = new InstanceSession(client, mockProfile);
  try {
    session.connect();
    await vi.advanceTimersByTimeAsync(500);
    expect(session.getSnapshot().runtime.samples.at(-1)?.connectionsOut).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    const snapshot = session.getSnapshot();
    expect(snapshot.streamErrors.service).toBeDefined();
    expect(snapshot.service?.status).toBe(ServiceStatus_Type.STARTED);
    expect(snapshot.runtime.samples.at(-1)?.connectionsOut).toBeUndefined();
  } finally {
    session.disconnect();
    vi.useRealTimers();
  }
});

it("clears even unpublished service events while keeping restart freshness and chart history", async () => {
  vi.useFakeTimers();
  const client = createMockClient();
  vi.spyOn(client, "getStartedAt")
    .mockResolvedValueOnce(create(StartedAtSchema, { startedAt: 10_000n }))
    .mockResolvedValue(create(StartedAtSchema, { startedAt: 20_000n }));
  vi.spyOn(client, "subscribeServiceStatus").mockImplementation(async function* (_, options) {
    const signal = options!.signal!;
    yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
    await delay(1200, signal);
    yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STOPPING });
    await delay(350, signal);
    yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
    yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
    await delay(750, signal);
    yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STOPPING });
    await delay(60_000, signal);
  });
  const session = new InstanceSession(client, mockProfile);
  const publish = vi.fn();
  const unsubscribe = session.subscribe(publish);
  try {
    const empty = session.getSnapshot();
    session.clearRuntimeEvents();
    expect(session.getSnapshot()).toBe(empty);
    expect(publish).not.toHaveBeenCalled();

    session.connect();
    await vi.advanceTimersByTimeAsync(1549);
    const before = session.getSnapshot();
    expect(before.runtime.samples[0]?.down).toBeUndefined();
    expect(before.runtime.samples.at(-1)?.down).toBeGreaterThan(0);
    expect(before.runtime.events.map(({ kind }) => kind)).toEqual(["service", "service"]);
    expect(before.runtime.lastBoot).toBe(10_000n);
    const signal = session.signal;

    await vi.advanceTimersByTimeAsync(2);
    expect(session.getSnapshot()).toBe(before);
    publish.mockClear();
    session.clearRuntimeEvents();
    const cleared = session.getSnapshot();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(cleared.runtime.events).toEqual([]);
    expect(cleared.runtime.samples).toBe(before.runtime.samples);
    expect(cleared.runtime.lastFrameAt.status).toBe(before.runtime.lastFrameAt.status);
    expect(cleared.runtime.lastFrameAt.service).toBeGreaterThan(before.runtime.lastFrameAt.service!);
    expect(cleared.runtime.lastBoot).toBe(20_000n);
    expect(cleared.startedAt).toBe(20_000n);
    expect(cleared.runtime.awaitingPostRestartSample).toBe(true);
    expect(cleared.status).toBe(before.status);
    expect(cleared.notifications).toBe(before.notifications);
    expect(session.signal).toBe(signal);
    expect(signal?.aborted).toBe(false);

    session.clearRuntimeEvents();
    expect(session.getSnapshot()).toBe(cleared);
    expect(publish).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(448);
    expect(session.getSnapshot().runtime.awaitingPostRestartSample).toBe(true);
    expect(session.getSnapshot().runtime.events).toEqual([]);
    session.clearOlderRuntimeSamples();
    expect(session.getSnapshot().runtime.samples).toEqual(cleared.runtime.samples.slice(-1));
    expect(session.getSnapshot().runtime.awaitingPostRestartSample).toBe(true);

    await vi.advanceTimersByTimeAsync(102);
    const resumed = session.getSnapshot().runtime;
    expect(resumed.lastFrameAt.status).toBeGreaterThan(cleared.runtime.lastFrameAt.status!);
    expect(resumed.awaitingPostRestartSample).toBe(false);
    expect(resumed.events).toEqual([]);
    expect(resumed.samples.at(-1)).toMatchObject({ gapBefore: true, down: undefined, up: undefined });

    await vi.advanceTimersByTimeAsync(199);
    expect(session.getSnapshot().runtime.events).toEqual([
      expect.objectContaining({ kind: "service", status: ServiceStatus_Type.STOPPING }),
    ]);
    session.disconnect();
    expect(session.getSnapshot().runtime).toEqual(initialSnapshot().runtime);
  } finally {
    unsubscribe();
    session.disconnect();
    vi.useRealTimers();
  }
});

it("leaves gaps in measured traffic after a late frame or a counter reset", async () => {
  vi.useFakeTimers();
  const client = createMockClient();
  vi.spyOn(client, "subscribeStatus").mockImplementation(async function* (_, options) {
    const signal = options!.signal!;
    for (const [wait, total] of [[0, 100n], [1000, 110n], [4000, 120n], [1000, 130n], [1000, 10n], [1000, 20n]] as const) {
      if (wait) await delay(wait, signal);
      yield create(StatusSchema, { trafficAvailable: true, downlink: 10n, downlinkTotal: total });
    }
    await delay(60_000, signal);
  });
  const session = new InstanceSession(client, mockProfile);
  try {
    session.connect();
    await vi.advanceTimersByTimeAsync(8200);
    expect(session.getSnapshot().runtime.samples.map(({ down, gapBefore }) => [down, gapBefore]))
      .toEqual([[undefined, false], [10, false], [undefined, true], [10, false], [undefined, true], [10, false]]);
  } finally {
    session.disconnect();
    vi.useRealTimers();
  }
});

it("keeps sibling streams running after a terminal status failure", async () => {
  vi.useFakeTimers();
  const client = createMockClient();
  vi.spyOn(client, "subscribeStatus").mockImplementation(async function* (_, options) {
    yield create(StatusSchema);
    await delay(600, options!.signal!);
    throw new ConnectError("status denied", Code.PermissionDenied);
  });
  const session = new InstanceSession(client, {
    ...mockProfile,
    preferences: { ...mockProfile.preferences, autoReconnect: false },
  });
  try {
    session.connect();
    await vi.advanceTimersByTimeAsync(750);
    const before = session.getSnapshot();
    expect(before.phase).toBe("error");
    expect(before.streamErrors.status).toBeDefined();
    expect(session.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(900);
    expect(session.getSnapshot().runtime.lastFrameAt.logs)
      .toBeGreaterThan(before.runtime.lastFrameAt.logs!);
  } finally {
    session.disconnect();
    vi.useRealTimers();
  }
});
