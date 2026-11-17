import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { InstanceSession } from "@/api/session";
import { createMockClient, MockControl } from "@/mocks/client";
import { mockProfile } from "@/features/instances/profiles";
import {
  GroupsSchema,
  VersionSchema,
  StatusSchema,
  LogSchema,
} from "@/proto/daemon/started_service_pb";
import { delay } from "@/api/errors";

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
    expect(s.getSnapshot().traffic).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2100);
    expect(interval).toBe(2_000_000_000n);
    expect(s.getSnapshot().traffic).toHaveLength(1);
    expect(s.getSnapshot().traffic[0]).toMatchObject({ up: 100, down: 2500 });
  });
  it("redacts credentials before any page or log export can consume a received message", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const s = new InstanceSession(
      {
        ...client,
        async *subscribeLog(_, options) {
          yield create(LogSchema, {
            messages: [
              { message: "server echoed private-token twice: private-token" },
            ],
          });
          await delay(100000, options!.signal!);
        },
      },
      mockProfile,
      "private-token",
    );
    sessions.push(s);
    s.connect();
    await vi.advanceTimersByTimeAsync(300);
    expect(s.getSnapshot().logs[0].message).toBe(
      "server echoed [redacted] twice: [redacted]",
    );
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
});
