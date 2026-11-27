import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilityFailure } from "@/api/capabilities";
import { DiagnosticExecutionError } from "@/api/diagnostics";
import { delay } from "@/api/errors";
import { InstanceSession } from "@/api/session";
import { validateDiagnosticTarget } from "@/features/diagnostics/model";
import { mockProfile } from "@/features/instances/profiles";
import { createMockClient } from "@/mocks/client";
import {
  DeprecatedWarningsSchema,
  ServiceStatusSchema,
  ServiceStatus_Type,
  STUNTestProgressSchema,
  StartedAtSchema,
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
    expect(session.getSnapshot().warnings).toMatchObject([{
      message: "Upgrade this setting",
      description: "Fixed secret: [redacted]",
      migrationLink: "",
    }]);
    session.disconnect();
    expect(session.getSnapshot().warnings).toBeUndefined();
    expect(session.getSnapshot().capabilities.outboundInventory.status).toBe("unknown");
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

it.each([
  ["", true, true],
  ["measure.example.org", true, true],
  ["http://127.0.0.1:8080/config", true, true],
  ["https://secrets@measure.example.org/config", true, false],
  ["file:///var/run/private", true, false],
  ["[2001:db8::1]:3478", false, true],
  ["stun.example.org:3478", false, true],
  ["stun.example.org:65536", false, false],
  ["stun.example.org:3478/other", false, false],
])("validates a diagnostic target %j", (value, quality, valid) => {
  expect(validateDiagnosticTarget(value, quality)).toBe(valid);
});
