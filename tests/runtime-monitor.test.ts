import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { expect, it, vi } from "vitest";
import { delay } from "@/api/errors";
import { recordRuntimeEvent, recordRuntimeSample } from "@/api/runtime";
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
  expect(afterGap.samples[0]).toMatchObject({ connectionsOut: undefined, gapBefore: true });
});

it("records an observed service restart without turning its first interval into a rate", async () => {
  vi.useFakeTimers();
  const client = createMockClient();
  vi.spyOn(client, "getStartedAt")
    .mockResolvedValueOnce(create(StartedAtSchema, { startedAt: 10_000n }))
    .mockResolvedValue(create(StartedAtSchema, { startedAt: 20_000n }));
  vi.spyOn(client, "subscribeServiceStatus").mockImplementation(async function* (_, options) {
    const signal = options?.signal ?? new AbortController().signal;
    yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
    await delay(1200, signal);
    yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STOPPING });
    await delay(300, signal);
    yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
    yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
    await delay(60_000, signal);
  });
  const session = new InstanceSession(client, mockProfile);
  try {
    session.connect();
    await vi.advanceTimersByTimeAsync(1100);
    const before = session.getSnapshot().runtime;
    expect(before.samples[0]?.down).toBeUndefined();
    expect(before.samples.at(-1)?.down).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1000);
    const runtime = session.getSnapshot().runtime;
    expect(runtime.lastFrameAt.status).toBeGreaterThan(before.lastFrameAt.status!);
    expect(runtime.events.map(({ kind }) => kind)).toEqual(["service", "service", "service", "restart"]);
    expect(runtime.events.at(-1)).toMatchObject({ kind: "restart", startedAt: 20_000n });
    expect(runtime.samples.at(-1)).toMatchObject({ gapBefore: true, down: undefined, up: undefined });
  } finally {
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
