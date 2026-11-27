import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilityFailure } from "@/api/capabilities";
import { DiagnosticExecutionError } from "@/api/diagnostics";
import { delay } from "@/api/errors";
import { InstanceSession } from "@/api/session";
import { capacitySample, diagnosticMeasurement, validateDiagnosticTarget, type CapacityTrace } from "@/features/diagnostics/model";
import { mockProfile } from "@/features/instances/profiles";
import { createMockClient } from "@/mocks/client";
import {
  ConnectionEventsSchema,
  ConnectionEventType,
  DeprecatedWarningsSchema,
  GroupsSchema,
  NetworkQualityTestProgressSchema,
  ServiceStatusSchema,
  ServiceStatus_Type,
  STUNTestProgressSchema,
  StartedAtSchema,
  StatusSchema,
  VersionSchema,
} from "@/proto/daemon/started_service_pb";

const sessions: InstanceSession[] = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.disconnect());
  vi.useRealTimers();
});

async function connect(client = createMockClient(), secret?: string) {
  vi.useFakeTimers();
  const session = new InstanceSession(client, mockProfile, secret);
  sessions.push(session);
  session.setInventoryEnabled(true);
  session.connect();
  await vi.advanceTimersByTimeAsync(200);
  return session;
}

describe("native diagnostic state", () => {
  it.each([
    [Code.Unimplemented, "unsupported"],
    [Code.NotFound, "unavailable"],
    [Code.Unauthenticated, "error"],
    [Code.PermissionDenied, "error"],
    [Code.Unavailable, "error"],
  ])("classifies RPC status %s as %s without exposing detail", (code, status) => {
    const capability = capabilityFailure(new ConnectError("private token", code));
    expect(capability).toMatchObject({ status, code });
    expect(capability.error).not.toContain("private token");
  });

  it("discovers capabilities without starting active tests and retains drained warnings", async () => {
    const client = createMockClient();
    const quality = vi.spyOn(client, "startNetworkQualityTest");
    const stun = vi.spyOn(client, "startSTUNTest");
    const latency = vi.spyOn(client, "uRLTest");
    vi.spyOn(client, "getDeprecatedWarnings")
      .mockResolvedValueOnce(create(DeprecatedWarningsSchema, {
        warnings: [
          {
            message: "Upgrade this setting",
            description: "Fixed secret: private/token",
            migrationLink: "https://sing-box.sagernet.org/migration/#private%2Ftoken",
          },
        ],
      }))
      .mockResolvedValue(create(DeprecatedWarningsSchema));
    const session = await connect(client, "private/token");
    expect(session.getSnapshot().capabilities).toMatchObject({
      networkQuality: { status: "unknown" },
      stun: { status: "unknown" },
      outboundInventory: { status: "supported" },
      deprecatedWarnings: { status: "supported" },
    });
    expect(quality).not.toHaveBeenCalled();
    expect(stun).not.toHaveBeenCalled();
    expect(latency).not.toHaveBeenCalled();
    await session.refreshWarnings();
    expect(session.redactText("route-private/token")).toBe("route-[redacted]");
    expect(session.getSnapshot().warnings).toMatchObject([{
      message: "Upgrade this setting",
      description: "Fixed secret: [redacted]",
      migrationLink: "",
    }]);
    session.disconnect();
    expect(session.getSnapshot().warnings).toBeUndefined();
    expect(session.getSnapshot().capabilities.outboundInventory.status).toBe("unknown");
  });

  it("waits for the first STARTED event before reading warnings", async () => {
    const client = createMockClient();
    const warnings = vi.spyOn(client, "getDeprecatedWarnings");
    vi.spyOn(client, "subscribeServiceStatus").mockImplementation(
      async function* (_, options) {
        await delay(500, options!.signal!);
        yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
        await delay(60_000, options!.signal!);
      },
    );
    const session = await connect(client);
    expect(warnings).not.toHaveBeenCalled();
    expect(session.getSnapshot().capabilities.deprecatedWarnings.status).toBe("unknown");
    await vi.advanceTimersByTimeAsync(700);
    expect(warnings).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().capabilities.deprecatedWarnings.status).toBe("supported");
  });

  it("retries a transient warning read when the same core's service stream recovers", async () => {
    const client = createMockClient();
    const warnings = vi.spyOn(client, "getDeprecatedWarnings")
      .mockRejectedValueOnce(new ConnectError("Temporary outage", Code.Unavailable));
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(
      async function* (_, options) {
        yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
        await delay(500, options!.signal!);
        throw new ConnectError("Service stream interrupted", Code.Unavailable);
      },
    );
    const session = await connect(client);
    expect(session.getSnapshot().capabilities.deprecatedWarnings).toMatchObject({
      status: "error", code: Code.Unavailable,
    });
    await vi.advanceTimersByTimeAsync(500);
    await session.refreshWarnings();
    expect(session.canRefreshWarnings).toBe(false);
    expect(warnings).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1400);
    expect(warnings).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().capabilities.deprecatedWarnings.status).toBe("supported");
  });

  it("retries once when an in-flight warning read fails after recovery", async () => {
    const client = createMockClient();
    const warnings = vi.spyOn(client, "getDeprecatedWarnings")
      .mockImplementationOnce(async (_, options) => {
        await delay(2000, options!.signal!);
        throw new ConnectError("Timed out", Code.DeadlineExceeded);
      });
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(
      async function* (_, options) {
        yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
        await delay(500, options!.signal!);
        throw new ConnectError("Service stream interrupted", Code.Unavailable);
      },
    );
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(1600);
    expect(warnings).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(900);
    expect(warnings).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().capabilities.deprecatedWarnings.status).toBe("supported");
  });

  it("keeps previously observed closed rows across rapid view changes on the same core", async () => {
    const client = createMockClient();
    let reads = 0;
    vi.spyOn(client, "subscribeConnections").mockImplementation(async function* (_, options) {
      const signal = options!.signal!;
      const first = ++reads === 1;
      if (!first) await delay(100, signal);
      const rows = first
        ? [{ id: "old-closed", closedAt: 5n }, { id: "old-active", closedAt: 0n }]
        : [{ id: "new-closed", closedAt: 8n }, { id: "new-active", closedAt: 0n }];
      yield create(ConnectionEventsSchema, {
        reset: true,
        events: rows.map((connection) => ({
          id: connection.id,
          type: ConnectionEventType.CONNECTION_EVENT_NEW,
          connection,
        })),
      });
      await delay(60_000, signal);
    });
    const session = await connect(client);
    session.setInventoryEnabled(false);
    await vi.advanceTimersByTimeAsync(200);
    expect([...session.getSnapshot().connections.keys()]).toEqual(["old-closed", "old-active"]);
    session.setInventoryEnabled(true);
    session.setInventoryEnabled(false);
    await vi.advanceTimersByTimeAsync(20);
    session.setInventoryEnabled(true);
    session.setInventoryEnabled(false);
    await vi.advanceTimersByTimeAsync(200);
    expect([...session.getSnapshot().connections.keys()]).toEqual(["old-closed", "new-closed", "new-active"]);
  });

  it("swaps inventory and connections without using two permanent request slots", async () => {
    const client = createMockClient();
    const inventory = vi.spyOn(client, "subscribeOutbounds");
    const connections = vi.spyOn(client, "subscribeConnections");
    const session = await connect(client);
    expect(connections).not.toHaveBeenCalled();
    const inventorySignal = inventory.mock.calls[0][1]?.signal;
    expect(inventorySignal?.aborted).toBe(false);
    session.setInventoryEnabled(false);
    expect(inventorySignal?.aborted).toBe(true);
    const connectionSignal = connections.mock.calls[0][1]?.signal;
    expect(connectionSignal?.aborted).toBe(false);
    session.setInventoryEnabled(true);
    expect(connectionSignal?.aborted).toBe(true);
    expect(inventory.mock.calls[1][1]?.signal?.aborted).toBe(false);
  });

  it("exposes an active inventory batch source until it completes", async () => {
    const session = await connect();
    const inventory = session.getSnapshot().outbounds!;
    const batch = session.testInventory(["Independent direct"], inventory);
    expect(session.getSnapshot().latencyTestSource).toBe("outbounds");
    await vi.advanceTimersByTimeAsync(500);
    await batch;
    expect(session.getSnapshot().latencyTestSource).toBeUndefined();
  });

  it("reevaluates capabilities after a native service stream is canceled by the core", async () => {
    const client = createMockClient();
    const warnings = vi.spyOn(client, "getDeprecatedWarnings");
    vi.spyOn(client, "getStartedAt")
      .mockResolvedValueOnce(create(StartedAtSchema, { startedAt: 1n }))
      .mockResolvedValue(create(StartedAtSchema, { startedAt: 2n }));
    const service = vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(
      async function* (_, options) {
        yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
        await delay(500, options!.signal!);
        throw new ConnectError("Native restart", Code.Canceled);
      },
    );
    const session = await connect(client);
    expect(warnings).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(session.getSnapshot().streamErrors.service).toBeDefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(service).toHaveBeenCalledTimes(2);
    expect(warnings).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().capabilities.outboundInventory.status).toBe("supported");
  });

  it("keeps the last core epoch through an optional metadata failure", async () => {
    const client = createMockClient();
    const warnings = vi.spyOn(client, "getDeprecatedWarnings");
    vi.spyOn(client, "getStartedAt")
      .mockResolvedValueOnce(create(StartedAtSchema, { startedAt: 1n }))
      .mockRejectedValueOnce(new ConnectError("Metadata unavailable", Code.Unavailable))
      .mockResolvedValue(create(StartedAtSchema, { startedAt: 2n }));
    const service = vi.spyOn(client, "subscribeServiceStatus");
    const interrupt = async function* (_: unknown, options?: { signal?: AbortSignal }) {
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(500, options!.signal!);
      throw new ConnectError("Service stream interrupted", Code.Canceled);
    };
    service.mockImplementationOnce(interrupt).mockImplementationOnce(interrupt);
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(1500);
    expect(session.getSnapshot().startedAt).toBe(1n);
    expect(warnings).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1800);
    expect(session.getSnapshot().startedAt).toBe(2n);
    expect(warnings).toHaveBeenCalledTimes(2);
  });

  it("keeps warnings from an observed restart if its first epoch read fails", async () => {
    const client = createMockClient();
    const warnings = vi.spyOn(client, "getDeprecatedWarnings")
      .mockResolvedValueOnce(create(DeprecatedWarningsSchema, { warnings: [{ message: "Old core" }] }))
      .mockResolvedValueOnce(create(DeprecatedWarningsSchema, { warnings: [{ message: "New core" }] }))
      .mockResolvedValue(create(DeprecatedWarningsSchema));
    const startedAt = vi.spyOn(client, "getStartedAt")
      .mockResolvedValueOnce(create(StartedAtSchema, { startedAt: 1n }))
      .mockRejectedValueOnce(new ConnectError("Metadata unavailable", Code.Unavailable))
      .mockResolvedValue(create(StartedAtSchema, { startedAt: 2n }));
    vi.spyOn(client, "subscribeStatus").mockImplementationOnce(async function* (_, options) {
      yield create(StatusSchema);
      await delay(100, options!.signal!);
      throw new ConnectError("Status interrupted", Code.Unavailable);
    });
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(async function* (_, options) {
      const signal = options!.signal!;
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(500, signal);
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STOPPING });
      await delay(100, signal);
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTING });
      await delay(1200, signal);
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(500, signal);
      throw new ConnectError("Service stream interrupted", Code.Canceled);
    });
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(1400);
    expect(session.getSnapshot().startedAt).toBeUndefined();
    expect(startedAt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(session.getSnapshot().startedAt).toBeUndefined();
    expect(session.getSnapshot().warnings).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1600);
    expect(session.getSnapshot().startedAt).toBe(2n);
    expect(session.getSnapshot().warnings).toMatchObject([{ message: "New core" }]);
    expect(warnings).toHaveBeenCalledTimes(2);
  });

  it("cancels superseded metadata rather than delaying status recovery", async () => {
    const client = createMockClient();
    let superseded: AbortSignal | undefined;
    vi.spyOn(client, "getStartedAt")
      .mockResolvedValueOnce(create(StartedAtSchema, { startedAt: 1n }))
      .mockImplementationOnce(async (_, options) => {
        superseded = options!.signal!;
        await delay(10_000, superseded);
        return create(StartedAtSchema, { startedAt: 1n });
      })
      .mockResolvedValue(create(StartedAtSchema, { startedAt: 2n }));
    vi.spyOn(client, "subscribeStatus").mockImplementationOnce(async function* (_, options) {
      yield create(StatusSchema);
      await delay(100, options!.signal!);
      throw new ConnectError("Status interrupted", Code.Unavailable);
    });
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(async function* (_, options) {
      const signal = options!.signal!;
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(1300, signal);
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STOPPING });
      await delay(100, signal);
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(60_000, signal);
    });
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(1000);
    expect(superseded?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(superseded?.aborted).toBe(true);
    expect(session.getSnapshot().phase).toBe("connected");
    expect(session.getSnapshot().startedAt).toBe(2n);
  });

  it("rechecks compatibility when the first service snapshot replaces a pending probe", async () => {
    const client = createMockClient();
    const version = (apiVersion: number) => create(VersionSchema, { apiVersion, version: "1.14.0" });
    let superseded: AbortSignal | undefined;
    vi.spyOn(client, "getVersion")
      .mockResolvedValueOnce(version(4))
      .mockImplementationOnce(async (_, options) => {
        superseded = options!.signal!;
        await delay(10_000, superseded);
        return version(4);
      })
      .mockResolvedValue(version(5));
    const warnings = vi.spyOn(client, "getDeprecatedWarnings");
    vi.spyOn(client, "subscribeStatus").mockImplementationOnce(async function* (_, options) {
      yield create(StatusSchema);
      await delay(100, options!.signal!);
      throw new ConnectError("Status interrupted", Code.Unavailable);
    });
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(async function* (_, options) {
      const signal = options!.signal!;
      await delay(1300, signal);
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(60_000, signal);
    });
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(1000);
    expect(superseded?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(superseded?.aborted).toBe(true);
    expect(session.getSnapshot().phase).toBe("error");
    expect(session.getSnapshot().error).toContain("Unsupported API");
    expect(warnings).not.toHaveBeenCalled();
  });

  it("revalidates a replacement API even before a new STARTED event", async () => {
    const client = createMockClient();
    const version = (apiVersion: number) => create(VersionSchema, { apiVersion, version: "1.14.0" });
    let superseded: AbortSignal | undefined;
    vi.spyOn(client, "getVersion")
      .mockResolvedValueOnce(version(4))
      .mockResolvedValueOnce(version(4))
      .mockImplementationOnce(async (_, options) => {
        superseded = options!.signal!;
        await delay(10_000, superseded);
        return version(4);
      })
      .mockResolvedValue(version(5));
    vi.spyOn(client, "subscribeStatus").mockImplementationOnce(async function* (_, options) {
      yield create(StatusSchema);
      await delay(100, options!.signal!);
      throw new ConnectError("Status interrupted", Code.Unavailable);
    });
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(async function* (_, options) {
      const signal = options!.signal!;
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(1300, signal);
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.IDLE });
      await delay(100, signal);
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTING });
      await delay(60_000, signal);
    });
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(1000);
    expect(superseded?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(superseded?.aborted).toBe(true);
    expect(session.getSnapshot().phase).toBe("error");
    expect(session.getSnapshot().error).toContain("Unsupported API");
  });

  it.each([Code.Unavailable, Code.Canceled])("retries the first boot metadata read after version error %s", async (code) => {
    const client = createMockClient();
    const version = create(VersionSchema, { apiVersion: 4, version: "1.14.0" });
    const versions = vi.spyOn(client, "getVersion")
      .mockResolvedValueOnce(version)
      .mockRejectedValueOnce(new ConnectError("Temporary outage", code))
      .mockResolvedValue(version);
    const warnings = vi.spyOn(client, "getDeprecatedWarnings");
    const session = await connect(client);
    expect(session.getSnapshot().startedAt).toBeUndefined();
    expect(warnings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(versions).toHaveBeenCalledTimes(3);
    expect(session.getSnapshot().startedAt).toBeGreaterThan(0n);
    expect(warnings).toHaveBeenCalledTimes(1);
  });

  it("releases a superseded service recovery until the next STARTED event", async () => {
    const client = createMockClient();
    const version = create(VersionSchema, { version: "1.14.0", apiVersion: 4 });
    const versions = vi.spyOn(client, "getVersion")
      .mockResolvedValueOnce(version)
      .mockImplementationOnce(async (_, options) => {
        await delay(5000, options!.signal!);
        return version;
      })
      .mockResolvedValue(version);
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(async function* (_, options) {
      const signal = options!.signal!;
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(500, signal);
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STOPPING });
      await delay(600, signal);
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(60_000, signal);
    });
    const session = await connect(client);
    const metadataSignal = versions.mock.calls[1][1]?.signal;
    expect(metadataSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(metadataSignal?.aborted).toBe(true);
    expect(versions).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(900);
    expect(versions).toHaveBeenCalledTimes(3);
    expect(session.getSnapshot().startedAt).toBeGreaterThan(0n);
  });

  it("holds core actions until lifecycle recovery verifies compatibility", async () => {
    const client = createMockClient();
    const version = create(VersionSchema, { version: "1.14.0", apiVersion: 4 });
    vi.spyOn(client, "getVersion")
      .mockResolvedValueOnce(version)
      .mockResolvedValueOnce(version)
      .mockImplementation(async (_, options) => {
        await delay(600, options!.signal!);
        return create(VersionSchema, { version: "1.14.0", apiVersion: 5 });
      });
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(async function* (_, options) {
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(500, options!.signal!);
      throw new ConnectError("Lifecycle interrupted", Code.Unavailable);
    });
    const test = vi.spyOn(client, "uRLTest");
    const select = vi.spyOn(client, "selectOutbound");
    const close = vi.spyOn(client, "closeConnection");
    const closeAll = vi.spyOn(client, "closeAllConnections");
    const stun = vi.spyOn(client, "startSTUNTest");
    const session = await connect(client);
    session.setInventoryEnabled(false);
    expect(session.getSnapshot().serviceActionsReady).toBe(true);
    await vi.advanceTimersByTimeAsync(1450);
    const snapshot = session.getSnapshot();
    expect(snapshot).toMatchObject({ phase: "connected", serviceActionsReady: false });
    expect(snapshot.streamErrors.service).toBeUndefined();
    expect(snapshot.loaded.connections).toBe(true);
    expect([...snapshot.connections.values()].some(({ closedAt }) => closedAt === 0n)).toBe(true);
    await expect(session.testLatency("Direct", 1)).rejects.toMatchObject({ code: Code.Canceled });
    await expect(session.selectOutbound("Primary route", "Direct")).rejects.toMatchObject({ code: Code.Unavailable });
    await expect(session.closeConnection("active")).rejects.toMatchObject({ code: Code.Unavailable });
    await expect(session.closeAllConnections()).rejects.toThrow("Wait for the connection list to refresh");
    await expect(session.runSTUN({}, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: Code.Canceled });
    expect(test).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(closeAll).not.toHaveBeenCalled();
    expect(stun).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(session.getSnapshot().error).toContain("Unsupported API");
  });

  it.each([
    ["confirmed restart", 400, 2n],
    ["unavailable timestamp", 1050, undefined],
  ] as const)("waits for fresh groups after recovery with %s", async (_, wait, marker) => {
    const client = createMockClient();
    vi.spyOn(client, "getStartedAt")
      .mockResolvedValueOnce(create(StartedAtSchema, { startedAt: 1n }))
      .mockImplementation(async (_, options) => {
        if (marker === undefined) throw new ConnectError("Timestamp unavailable", Code.Unavailable);
        await delay(400, options!.signal!);
        return create(StartedAtSchema, { startedAt: marker });
      });
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(async function* (_, options) {
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(500, options!.signal!);
      throw new ConnectError("Lifecycle interrupted", Code.Unavailable);
    });
    vi.spyOn(client, "subscribeGroups")
      .mockImplementationOnce(async function* (_, options) {
        yield create(GroupsSchema);
        await delay(60_000, options!.signal!);
      })
      .mockImplementation(async function* (_, options) {
        await delay(800, options!.signal!);
        yield create(GroupsSchema);
        await delay(60_000, options!.signal!);
      });
    const test = vi.spyOn(client, "uRLTest");
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(1450);
    expect(session.getSnapshot().serviceActionsReady).toBe(false);
    expect(session.getSnapshot().groups).toBeUndefined();
    await vi.advanceTimersByTimeAsync(wait);
    expect(session.getSnapshot().startedAt).toBe(marker);
    expect(session.getSnapshot().groups).toBeUndefined();
    await expect(session.testLatency("Direct", 1)).rejects.toMatchObject({ code: Code.Canceled });
    expect(test).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(900);
    expect(session.getSnapshot().serviceActionsReady).toBe(true);
    expect(session.getSnapshot().groups).toBeDefined();
  });

  it("retries transient boot timestamp failures within the current generation", async () => {
    const client = createMockClient();
    const startedAt = vi.spyOn(client, "getStartedAt")
      .mockRejectedValueOnce(new ConnectError("Temporary outage", Code.Unavailable))
      .mockResolvedValue(create(StartedAtSchema, { startedAt: 1n }));
    const session = await connect(client);
    expect(session.getSnapshot().startedAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1300);
    expect(startedAt).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().startedAt).toBe(1n);
  });

  it("surfaces an actionable error when metadata recovery cannot continue", async () => {
    const client = createMockClient();
    vi.spyOn(client, "getVersion")
      .mockResolvedValueOnce(create(VersionSchema, { apiVersion: 4, version: "1.14.0" }))
      .mockRejectedValue(new ConnectError("Private detail", Code.PermissionDenied));
    const session = await connect(client);
    expect(session.getSnapshot()).toMatchObject({
      phase: "error",
      error: "This instance denied access. Check its access policy.",
    });
    expect(session.signal?.aborted).toBe(true);
  });

  it("cancels the pending boot marker when status fails permanently", async () => {
    const client = createMockClient();
    const startedAt = vi.spyOn(client, "getStartedAt").mockImplementation(async (_, options) => {
      await delay(5000, options!.signal!);
      throw new ConnectError("Unavailable", Code.Unavailable);
    });
    const warnings = vi.spyOn(client, "getDeprecatedWarnings");
    vi.spyOn(client, "subscribeStatus").mockImplementationOnce(async function* (_, options) {
      yield create(StatusSchema);
      await delay(500, options!.signal!);
      throw new ConnectError("Status access denied", Code.PermissionDenied);
    });
    const session = await connect(client);
    const markerSignal = startedAt.mock.calls[0][1]?.signal;
    expect(markerSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(session.getSnapshot()).toMatchObject({ phase: "error", checkingWarnings: false });
    expect(markerSignal?.aborted).toBe(true);
    expect(startedAt).toHaveBeenCalledTimes(1);
    expect(session.signal?.aborted).toBe(false);
    expect(session.canRefreshWarnings).toBe(false);
    await session.refreshWarnings();
    expect(warnings).not.toHaveBeenCalled();
  });

  it("stops metadata retries and ignores recovery requests after terminal status failure", async () => {
    const client = createMockClient();
    const version = create(VersionSchema, { version: "1.14.0", apiVersion: 4 });
    const unavailable = new ConnectError("Temporarily unavailable", Code.Unavailable);
    const versions = vi.spyOn(client, "getVersion")
      .mockResolvedValueOnce(version)
      .mockResolvedValueOnce(version)
      .mockRejectedValue(unavailable);
    const running = create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
    vi.spyOn(client, "subscribeServiceStatus")
      .mockImplementationOnce(async function* (_, options) {
        yield running;
        await delay(500, options!.signal!);
        throw unavailable;
      })
      .mockImplementationOnce(async function* (_, options) {
        const signal = options!.signal!;
        yield running;
        await delay(500, signal);
        yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STOPPING });
        yield running;
        await delay(60_000, signal);
      });
    vi.spyOn(client, "subscribeStatus").mockImplementationOnce(async function* (_, options) {
      yield create(StatusSchema);
      await delay(1750, options!.signal!);
      throw new ConnectError("Status access denied", Code.PermissionDenied);
    });
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(1400);
    expect(versions).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(session.getSnapshot().phase).toBe("error");
    expect(versions).toHaveBeenCalledTimes(3);
    expect(session.signal?.aborted).toBe(false);
  });

  it("does not replace cancelled in-flight metadata after terminal status failure", async () => {
    const client = createMockClient();
    const version = create(VersionSchema, { version: "1.14.0", apiVersion: 4 });
    const versions = vi.spyOn(client, "getVersion")
      .mockResolvedValueOnce(version)
      .mockImplementationOnce(async (_, options) => {
        await delay(5000, options!.signal!);
        return version;
      })
      .mockResolvedValue(version);
    vi.spyOn(client, "subscribeStatus").mockImplementationOnce(async function* (_, options) {
      yield create(StatusSchema);
      await delay(500, options!.signal!);
      throw new ConnectError("Status access denied", Code.PermissionDenied);
    });
    const session = await connect(client);
    const metadataSignal = versions.mock.calls[1][1]?.signal;
    expect(metadataSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().phase).toBe("error");
    expect(metadataSignal?.aborted).toBe(true);
    expect(versions).toHaveBeenCalledTimes(2);
  });

  it("restores status and warning reads while the boot timestamp stays temporarily unavailable", async () => {
    const client = createMockClient();
    const unavailable = new ConnectError("Temporary outage", Code.Unavailable);
    const startedAt = vi.spyOn(client, "getStartedAt")
      .mockResolvedValueOnce(create(StartedAtSchema, { startedAt: 1n }))
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValue(create(StartedAtSchema, { startedAt: 2n }));
    const warnings = vi.spyOn(client, "getDeprecatedWarnings");
    const connections = vi.spyOn(client, "subscribeConnections");
    vi.spyOn(client, "subscribeStatus").mockImplementationOnce(async function* (_, options) {
      yield create(StatusSchema);
      await delay(500, options!.signal!);
      throw new ConnectError("Status interrupted", Code.Unavailable);
    });
    const session = await connect(client);
    session.setInventoryEnabled(false);
    await vi.advanceTimersByTimeAsync(1800);
    expect(session.getSnapshot().phase).toBe("connected");
    expect(session.getSnapshot().startedAt).toBe(1n);
    expect(warnings).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().startedAt).toBeUndefined();
    expect(session.canRefreshWarnings).toBe(true);
    expect(warnings).toHaveBeenCalledTimes(2);
    expect(connections).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().connections.get("mock-closed-1")?.closedAt).toBeGreaterThan(0n);
    await vi.advanceTimersByTimeAsync(1800);
    expect(startedAt).toHaveBeenCalledTimes(4);
    expect(session.getSnapshot().startedAt).toBe(2n);
    expect(connections).toHaveBeenCalledTimes(3);
    expect(session.getSnapshot().groups?.length).toBeGreaterThan(0);
    expect(session.getSnapshot().warnings).toBeDefined();
    expect(warnings).toHaveBeenCalledTimes(2);
  });

  it.each([
    [1n, ["Old", "Provisional", "Current"]],
    [2n, ["Current"]],
  ] as const)("attributes provisional warnings after confirming boot %s", async (marker, messages) => {
    const client = createMockClient();
    const unavailable = new ConnectError("Timestamp temporarily unavailable", Code.Unavailable);
    vi.spyOn(client, "getStartedAt")
      .mockResolvedValueOnce(create(StartedAtSchema, { startedAt: 1n }))
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValue(create(StartedAtSchema, { startedAt: marker }));
    const warnings = vi.spyOn(client, "getDeprecatedWarnings")
      .mockResolvedValueOnce(create(DeprecatedWarningsSchema, { warnings: [{ message: "Old" }] }))
      .mockResolvedValueOnce(create(DeprecatedWarningsSchema, { warnings: [{ message: "Provisional" }] }))
      .mockResolvedValue(create(DeprecatedWarningsSchema, { warnings: [{ message: "Current" }] }));
    vi.spyOn(client, "subscribeStatus").mockImplementationOnce(async function* (_, options) {
      yield create(StatusSchema);
      await delay(100, options!.signal!);
      throw new ConnectError("Status interrupted", Code.Unavailable);
    });
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(async function* (_, options) {
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(2700, options!.signal!);
      throw new ConnectError("Service interrupted", Code.Unavailable);
    });
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(2200);
    expect(session.getSnapshot().startedAt).toBeUndefined();
    expect(session.getSnapshot().warnings).toMatchObject([{ message: "Provisional" }]);
    await vi.advanceTimersByTimeAsync(1600);
    expect(session.getSnapshot().startedAt).toBe(marker);
    expect(session.getSnapshot().warnings?.map(({ message }) => message)).toEqual(messages);
    expect(warnings).toHaveBeenCalledTimes(3);
  });

  it("preserves a warning response in flight when the same boot became temporarily unconfirmed", async () => {
    const client = createMockClient();
    const unavailable = new ConnectError("Timestamp temporarily unavailable", Code.Unavailable);
    vi.spyOn(client, "getStartedAt")
      .mockResolvedValueOnce(create(StartedAtSchema, { startedAt: 1n }))
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValue(create(StartedAtSchema, { startedAt: 1n }));
    const warnings = vi.spyOn(client, "getDeprecatedWarnings")
      .mockImplementationOnce(async (_, options) => {
        await delay(3200, options!.signal!);
        return create(DeprecatedWarningsSchema, { warnings: [{ message: "Delayed report" }] });
      })
      .mockResolvedValue(create(DeprecatedWarningsSchema));
    vi.spyOn(client, "subscribeStatus").mockImplementationOnce(async function* (_, options) {
      yield create(StatusSchema);
      await delay(500, options!.signal!);
      throw new ConnectError("Status interrupted", Code.Unavailable);
    });
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(2600);
    expect(session.getSnapshot().startedAt).toBeUndefined();
    expect(session.getSnapshot().checkingWarnings).toBe(true);
    expect(warnings).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(session.getSnapshot().warnings).toMatchObject([{ message: "Delayed report" }]);
    expect(session.getSnapshot().checkingWarnings).toBe(false);
    expect(warnings).toHaveBeenCalledTimes(2);
  });

  it("keeps provisional warnings when only the status stream reconnects again", async () => {
    const client = createMockClient();
    const unavailable = new ConnectError("Temporarily unavailable", Code.Unavailable);
    vi.spyOn(client, "getStartedAt")
      .mockResolvedValueOnce(create(StartedAtSchema, { startedAt: 1n }))
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValue(create(StartedAtSchema, { startedAt: 2n }));
    const warnings = vi.spyOn(client, "getDeprecatedWarnings")
      .mockResolvedValueOnce(create(DeprecatedWarningsSchema, { warnings: [{ message: "Old report" }] }))
      .mockResolvedValueOnce(create(DeprecatedWarningsSchema, { warnings: [{ message: "New report" }] }))
      .mockResolvedValue(create(DeprecatedWarningsSchema));
    vi.spyOn(client, "subscribeStatus")
      .mockImplementationOnce(async function* (_, options) {
        yield create(StatusSchema);
        await delay(500, options!.signal!);
        throw unavailable;
      })
      .mockImplementationOnce(async function* (_, options) {
        yield create(StatusSchema);
        await delay(1400, options!.signal!);
        throw unavailable;
      });
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(2500);
    expect(session.getSnapshot().startedAt).toBeUndefined();
    expect(session.getSnapshot().warnings).toMatchObject([{ message: "New report" }]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(session.getSnapshot().startedAt).toBe(2n);
    expect(session.getSnapshot().warnings).toMatchObject([{ message: "New report" }]);
    expect(warnings).toHaveBeenCalledTimes(2);
  });

  it.each([0, 3000])("excludes an unverified boot's warnings after a lifecycle gap (response delay %s)", async (responseDelay) => {
    const client = createMockClient();
    const unavailable = new ConnectError("Temporarily unavailable", Code.Unavailable);
    vi.spyOn(client, "getStartedAt")
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValue(create(StartedAtSchema, { startedAt: 2n }));
    const warnings = vi.spyOn(client, "getDeprecatedWarnings")
      .mockImplementationOnce(async (_, options) => {
        if (responseDelay) await delay(responseDelay, options!.signal!);
        return create(DeprecatedWarningsSchema, { warnings: [{ message: "First boot" }] });
      })
      .mockResolvedValue(create(DeprecatedWarningsSchema, { warnings: [{ message: "Current boot" }] }));
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(async function* (_, options) {
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(1700, options!.signal!);
      throw unavailable;
    });
    const subscribeGroups = client.subscribeGroups;
    const groups = vi.spyOn(client, "subscribeGroups")
      .mockImplementationOnce(subscribeGroups)
      .mockImplementationOnce(subscribeGroups)
      .mockImplementation(async function* (_, options) {
        await delay(600, options!.signal!);
        yield create(GroupsSchema);
        await delay(60_000, options!.signal!);
      });
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(1100);
    expect(session.getSnapshot().startedAt).toBeUndefined();
    expect(warnings).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().groups).toBeDefined();
    await vi.advanceTimersByTimeAsync(1600);
    expect(session.getSnapshot().startedAt).toBe(2n);
    expect(groups).toHaveBeenCalledTimes(3);
    expect(session.getSnapshot().groups).toBeUndefined();
    await expect(session.testLatency("Direct", 1)).rejects.toMatchObject({ code: Code.Canceled });
    await vi.advanceTimersByTimeAsync(1500);
    expect(session.getSnapshot().checkingWarnings).toBe(false);
    expect(session.getSnapshot().warnings).toMatchObject([{ message: "Current boot" }]);
    expect(warnings).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().groups).toBeDefined();
  });

  it("refreshes topology when the first confirmed marker arrives during a lifecycle gap", async () => {
    const client = createMockClient();
    const unavailable = new ConnectError("Temporarily unavailable", Code.Unavailable);
    vi.spyOn(client, "getStartedAt")
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValue(create(StartedAtSchema, { startedAt: 2n }));
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(async function* (_, options) {
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(2400, options!.signal!);
      throw unavailable;
    });
    const subscribeGroups = client.subscribeGroups;
    const groups = vi.spyOn(client, "subscribeGroups")
      .mockImplementationOnce(subscribeGroups)
      .mockImplementationOnce(subscribeGroups)
      .mockImplementation(async function* (_, options) {
        await delay(800, options!.signal!);
        yield create(GroupsSchema);
        await delay(60_000, options!.signal!);
      });
    let connectionSubscriptions = 0;
    vi.spyOn(client, "subscribeConnections").mockImplementation(async function* (_, options) {
      const events = ++connectionSubscriptions < 3
        ? [{ id: "previous-closed", connection: { id: "previous-closed", closedAt: 1n } }]
        : [];
      yield create(ConnectionEventsSchema, { reset: true, events });
      await delay(60_000, options!.signal!);
    });
    const session = await connect(client);
    session.setInventoryEnabled(false);
    await vi.advanceTimersByTimeAsync(1500);
    const beforeGap = session.getSnapshot().topologyGeneration;
    await vi.advanceTimersByTimeAsync(1600);
    expect(session.getSnapshot().startedAt).toBe(2n);
    expect(session.getSnapshot().topologyGeneration).toBeGreaterThan(beforeGap);
    expect(session.getSnapshot().streamErrors.service).toBeDefined();
    expect(groups).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().connections.has("previous-closed")).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(session.getSnapshot().streamErrors.service).toBeUndefined();
    expect(session.getSnapshot().groups).toBeUndefined();
    expect(groups).toHaveBeenCalledTimes(3);
    expect(connectionSubscriptions).toBe(3);
    expect(session.getSnapshot().connections.has("previous-closed")).toBe(false);
    await expect(session.testLatency("Direct", 1)).rejects.toMatchObject({ code: Code.Canceled });
    await vi.advanceTimersByTimeAsync(900);
    expect(session.getSnapshot().groups).toBeDefined();
  });

  it("keeps ownership of an in-flight new warning read across restart confirmation", async () => {
    const client = createMockClient();
    const unavailable = new ConnectError("Timestamp temporarily unavailable", Code.Unavailable);
    vi.spyOn(client, "getStartedAt")
      .mockResolvedValueOnce(create(StartedAtSchema, { startedAt: 1n }))
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValue(create(StartedAtSchema, { startedAt: 2n }));
    const warnings = vi.spyOn(client, "getDeprecatedWarnings")
      .mockResolvedValueOnce(create(DeprecatedWarningsSchema, { warnings: [{ message: "Old report" }] }))
      .mockImplementationOnce(async (_, options) => {
        await delay(3000, options!.signal!);
        return create(DeprecatedWarningsSchema, { warnings: [{ message: "New report" }] });
      })
      .mockResolvedValue(create(DeprecatedWarningsSchema));
    vi.spyOn(client, "subscribeStatus").mockImplementationOnce(async function* (_, options) {
      yield create(StatusSchema);
      await delay(500, options!.signal!);
      throw new ConnectError("Status interrupted", Code.Unavailable);
    });
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(4600);
    expect(session.getSnapshot().startedAt).toBe(2n);
    expect(session.getSnapshot().checkingWarnings).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().warnings).toMatchObject([{ message: "New report" }]);
    expect(session.getSnapshot().checkingWarnings).toBe(false);
    expect(warnings).toHaveBeenCalledTimes(2);
  });

  it("preserves reports across repeated checks of an observed new boot", async () => {
    const client = createMockClient();
    const unavailable = new ConnectError("Timestamp temporarily unavailable", Code.Unavailable);
    vi.spyOn(client, "getStartedAt")
      .mockResolvedValueOnce(create(StartedAtSchema, { startedAt: 1n }))
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValue(create(StartedAtSchema, { startedAt: 2n }));
    const warnings = vi.spyOn(client, "getDeprecatedWarnings")
      .mockResolvedValueOnce(create(DeprecatedWarningsSchema, { warnings: [{ message: "Old report" }] }))
      .mockResolvedValueOnce(create(DeprecatedWarningsSchema, { warnings: [{ message: "New report" }] }))
      .mockResolvedValue(create(DeprecatedWarningsSchema));
    vi.spyOn(client, "subscribeStatus").mockImplementationOnce(async function* (_, options) {
      yield create(StatusSchema);
      await delay(1800, options!.signal!);
      throw new ConnectError("Status interrupted", Code.Unavailable);
    });
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(async function* (_, options) {
      const signal = options!.signal!;
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(500, signal);
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STOPPING });
      await delay(100, signal);
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(60_000, signal);
    });
    const session = await connect(client);
    await vi.advanceTimersByTimeAsync(1500);
    expect(session.getSnapshot().startedAt).toBeUndefined();
    expect(session.getSnapshot().warnings).toMatchObject([{ message: "New report" }]);
    await vi.advanceTimersByTimeAsync(1400);
    expect(session.getSnapshot().startedAt).toBe(2n);
    expect(session.getSnapshot().warnings).toMatchObject([{ message: "New report" }]);
    expect(warnings).toHaveBeenCalledTimes(2);
  });

  it("stops the warning spinner when a terminal metadata error aborts its request", async () => {
    const client = createMockClient();
    const version = create(VersionSchema, { apiVersion: 4, version: "1.14.0" });
    vi.spyOn(client, "getVersion")
      .mockResolvedValueOnce(version)
      .mockResolvedValueOnce(version)
      .mockRejectedValue(new ConnectError("Private detail", Code.PermissionDenied));
    vi.spyOn(client, "getDeprecatedWarnings").mockImplementation(async (_, options) => {
      await delay(10_000, options!.signal!);
      return create(DeprecatedWarningsSchema);
    });
    vi.spyOn(client, "subscribeServiceStatus").mockImplementationOnce(async function* (_, options) {
      yield create(ServiceStatusSchema, { status: ServiceStatus_Type.STARTED });
      await delay(500, options!.signal!);
      throw new ConnectError("Service interrupted", Code.Unavailable);
    });
    const session = await connect(client);
    expect(session.getSnapshot().checkingWarnings).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(session.getSnapshot()).toMatchObject({
      phase: "error",
      checkingWarnings: false,
    });
    expect(session.signal?.aborted).toBe(true);
  });

  it("rejects an EOF without a terminal result and redacts terminal diagnostic errors", async () => {
    const client = createMockClient();
    vi.spyOn(client, "startSTUNTest")
      .mockImplementationOnce(async function* () {
        yield create(STUNTestProgressSchema, { phase: 3 });
      })
      .mockImplementationOnce(async function* () {
        yield create(STUNTestProgressSchema, { isFinal: true, error: "private/token" });
      });
    const session = await connect(client);
    const { signal } = new AbortController();
    await expect(session.runSTUN({}, signal, vi.fn())).rejects.toMatchObject({ code: Code.Unavailable });
    await expect(session.runSTUN({}, signal, vi.fn())).rejects.toBeInstanceOf(DiagnosticExecutionError);
    await vi.advanceTimersByTimeAsync(100);
    expect(session.getSnapshot().capabilities.stun.status).toBe("supported");
  });

  it("rejects a late final after user cancellation and releases the diagnostic scope", async () => {
    const client = createMockClient();
    vi.spyOn(client, "startSTUNTest").mockImplementation(async function* () {
      yield create(STUNTestProgressSchema, { phase: 0 });
      await delay(250, new AbortController().signal);
      yield create(STUNTestProgressSchema, { phase: 3, isFinal: true });
    });
    const session = await connect(client);
    const controller = new AbortController();
    const progress = vi.fn();
    const test = session.runSTUN({}, controller.signal, progress);
    const canceled = expect(test).rejects.toMatchObject({ code: Code.Canceled });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(250);
    await canceled;
    expect(progress).toHaveBeenCalledTimes(1);
    const next = session.runSTUN({}, new AbortController().signal, vi.fn());
    await vi.advanceTimersByTimeAsync(250);
    await expect(next).resolves.toMatchObject({ phase: 3, isFinal: true });
  });
});

it("leaves serial gaps until capacity is observed and keeps measured zeros", () => {
  const trace: CapacityTrace = { elapsedMs: 0n, announced: new Set() };
  const progress = (phase: number, elapsedMs: bigint, downloadCapacity = 0n, uploadCapacity = 0n) =>
    capacitySample(create(NetworkQualityTestProgressSchema, {
      phase, elapsedMs, downloadCapacity, uploadCapacity,
    }), true, trace);
  expect(progress(1, 0n)).toBeUndefined();
  expect(progress(1, 750n)).toEqual({ elapsed: 0.75, download: 0, upload: undefined });
  expect(progress(1, 800n, 12_000_000n)).toEqual({ elapsed: 0.8, download: 12, upload: undefined });
  expect(progress(1, 900n)).toEqual({ elapsed: 0.9, download: 0, upload: undefined });
  expect(progress(2, 1000n, 12_000_000n)).toEqual({ elapsed: 1, download: 12, upload: undefined });
  expect(progress(2, 1750n, 12_000_000n, 4_000_000n)).toEqual({ elapsed: 1.75, download: 12, upload: 4 });
  expect(progress(2, 1800n, 12_000_000n)).toEqual({ elapsed: 1.8, download: 12, upload: 0 });
});

it("uses the originating direction in parallel frames despite stale snapshots and out-of-order timestamps", () => {
  const trace: CapacityTrace = { elapsedMs: 0n, announced: new Set() };
  const progress = (phase: number, elapsedMs: bigint, downloadCapacity = 0n, uploadCapacity = 0n) =>
    capacitySample(create(NetworkQualityTestProgressSchema, {
      phase, elapsedMs, downloadCapacity, uploadCapacity,
      downloadRPM: Number(downloadCapacity / 1_000_000n),
      uploadRPM: Number(uploadCapacity / 1_000_000n),
    }), false, trace);
  expect(progress(1, 0n)).toBeUndefined();
  expect(progress(2, 1n)).toBeUndefined();
  expect(progress(2, 850n, 0n, 4_000_000n)).toEqual({ elapsed: 0.85, download: undefined, upload: 4 });
  expect(progress(1, 840n)).toEqual({ elapsed: 0.85, download: 0, upload: 4 });
  expect(progress(2, 875n, 0n, 5_000_000n)).toEqual({ elapsed: 0.875, download: 0, upload: 5 });
  expect(progress(1, 900n, 12_000_000n, 4_000_000n)).toEqual({ elapsed: 0.9, download: 12, upload: 5 });
  expect(progress(2, 950n, 0n, 0n)).toEqual({ elapsed: 0.95, download: 12, upload: 0 });
  expect(progress(1, 925n, 13_000_000n, 5_000_000n)).toEqual({ elapsed: 0.95, download: 13, upload: 0 });
  expect(progress(2, 1000n, 0n, 5_000_000n)).toEqual({ elapsed: 1, download: 13, upload: 5 });
  expect(trace).toMatchObject({ downloadRPM: 13, uploadRPM: 5 });
  expect(progress(3, 0n, 14_000_000n, 6_000_000n)).toEqual({ elapsed: 1, download: 14, upload: 6 });
});

it("exports missing responsiveness separately from a zero capacity", () => {
  expect(diagnosticMeasurement(create(NetworkQualityTestProgressSchema, {
    phase: 3,
    isFinal: true,
  }), undefined)).toMatchObject({
    downloadBitsPerSecond: "0",
    uploadBitsPerSecond: "0",
    downloadRPM: null,
    uploadRPM: null,
    downloadRPMAccuracy: undefined,
    uploadRPMAccuracy: undefined,
  });
});

it.each([
  ["", true, true],
  ["measure.example.org", true, true],
  ["http://127.0.0.1:8080/config", true, true],
  ["https://secrets@measure.example.org/config", true, false],
  ["file:///var/run/private", true, false],
  ["[2001:db8::1]:3478", false, true],
  ["2001:db8::1", false, true],
  ["2001:db8::", false, true],
  ["stun.example.org:3478", false, true],
  ["stun.example.org:65536", false, false],
  ["stun.example.org:3478/other", false, false],
])("validates a diagnostic target %j", (value, quality, valid) => {
  expect(validateDiagnosticTarget(value, quality)).toBe(valid);
});
