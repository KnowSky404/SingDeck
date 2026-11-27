import { create } from "@bufbuild/protobuf";
import { afterEach, expect, it, vi } from "vitest";
import { initialSnapshot, type Snapshot } from "@/api/state";
import {
  observeConnectionRates,
  type ConnectionRateMeasurement,
} from "@/features/connections/observed-rates";
import { defaultProfile } from "@/features/instances/profiles";
import { ConnectionSchema, type Connection } from "@/proto/daemon/started_service_pb";

const id = "observed-connection";
const row = (uplinkTotal: bigint, downlinkTotal: bigint) =>
  create(ConnectionSchema, {
    id,
    createdAt: 1n,
    uplink: 500n,
    downlink: 750n,
    uplinkTotal,
    downlinkTotal,
  });

function observation() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const visibility = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", visibility);
  let snapshot: Snapshot = {
    ...initialSnapshot(),
    phase: "connected",
    serviceActionsReady: true,
    loaded: { connections: true },
    connections: new Map([[id, row(1000n, 4000n)]]),
  };
  const listeners = new Set<() => void>();
  const session = {
    profile: defaultProfile,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const publish = vi.fn<(value: ConnectionRateMeasurement | null) => void>();
  const stop = observeConnectionRates(session, id, publish);
  return {
    publish,
    visibility,
    stop,
    snapshot: session.getSnapshot,
    emit(patch: Partial<Snapshot>) {
      snapshot = { ...snapshot, ...patch };
      listeners.forEach(listener => listener());
    },
    update(record: Connection, milliseconds = 1000) {
      vi.advanceTimersByTime(milliseconds);
      snapshot = { ...snapshot, connections: new Map([[id, record]]) };
      listeners.forEach(listener => listener());
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("uses two changes after opening, divides by elapsed time, and expires despite another row updating", () => {
  const observed = observation();
  expect(observed.publish).not.toHaveBeenCalled();
  observed.update(row(1500n, 4750n));
  expect(observed.publish).not.toHaveBeenCalled();
  const measured = row(2000n, 5500n);
  observed.update(measured, 1500);
  expect(observed.publish).toHaveBeenLastCalledWith(expect.objectContaining({
    upload: 500 / 1.5,
    download: 750 / 1.5,
    record: measured,
  }));

  vi.advanceTimersByTime(1500);
  const other = create(ConnectionSchema, { ...row(3000n, 7000n), id: "different-connection" });
  observed.emit({ connections: new Map([[id, measured], [other.id, other]]) });
  expect(observed.publish).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(500);
  expect(observed.publish).toHaveBeenLastCalledWith(null);

  const resumed = create(ConnectionSchema, { ...row(2000n, 6250n), uplink: 0n });
  observed.update(resumed);
  expect(observed.publish).toHaveBeenCalledTimes(2);
  observed.update(create(ConnectionSchema, { ...row(2000n, 7000n), uplink: 0n }));
  expect(observed.publish).toHaveBeenLastCalledWith(expect.objectContaining({ upload: 0, download: 750 }));
  observed.stop();
  vi.advanceTimersByTime(3000);
  expect(observed.publish).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  ["a zero marker", create(ConnectionSchema, { ...row(2000n, 5500n), uplink: 0n, downlink: 0n })],
  ["a negative delta", create(ConnectionSchema, { ...row(2000n, 5500n), uplink: -1n })],
  ["a counter rewind", row(1500n, 5000n)],
  ["an interval larger than the cumulative count", row(499n, 6250n)],
] as const)("withholds a rate after %s", (_case, changed) => {
  const observed = observation();
  observed.update(row(1500n, 4750n));
  observed.update(row(2000n, 5500n));
  expect(observed.publish).toHaveBeenLastCalledWith(expect.objectContaining({ upload: 500, download: 750 }));
  observed.update(changed);
  expect(observed.publish).toHaveBeenLastCalledWith(null);
  observed.update(row(2500n, 6250n));
  expect(observed.publish).toHaveBeenCalledTimes(2);
  observed.update(row(3000n, 7000n));
  expect(observed.publish).toHaveBeenLastCalledWith(expect.objectContaining({ upload: 500, download: 750 }));
  observed.stop();
});

it.each([499, 2000])("uses an out-of-window %i ms pair only to start a new baseline", elapsed => {
  const observed = observation();
  observed.update(row(1500n, 4750n));
  observed.update(row(2000n, 5500n), elapsed);
  expect(observed.publish).not.toHaveBeenCalled();
  observed.update(row(2500n, 6250n), 500);
  expect(observed.publish).toHaveBeenLastCalledWith(expect.objectContaining({ upload: 1000, download: 1500 }));
  observed.stop();
});

it.each(["reset", "topology", "current loss", "same-ID replacement", "hidden"] as const)(
  "discards the pre-change rate and baseline after %s",
  change => {
    const observed = observation();
    observed.update(row(1500n, 4750n));
    observed.update(row(2000n, 5500n));
    expect(observed.publish).toHaveBeenLastCalledWith(expect.objectContaining({ upload: 500, download: 750 }));

    let createdAt = 1n;
    if (change === "reset") observed.emit({ connectionGeneration: observed.snapshot().connectionGeneration + 1 });
    if (change === "topology") observed.emit({ topologyGeneration: observed.snapshot().topologyGeneration + 1 });
    if (change === "current loss") {
      observed.emit({ serviceActionsReady: false });
      observed.emit({ serviceActionsReady: true });
    }
    if (change === "same-ID replacement") {
      createdAt = 2n;
      observed.update(create(ConnectionSchema, { ...row(2500n, 6250n), createdAt }));
    }
    if (change === "hidden") {
      observed.visibility.hidden = true;
      observed.visibility.dispatchEvent(new Event("visibilitychange"));
      observed.visibility.hidden = false;
      observed.visibility.dispatchEvent(new Event("visibilitychange"));
    }

    expect(observed.publish).toHaveBeenLastCalledWith(null);
    observed.update(create(ConnectionSchema, { ...row(3000n, 7000n), createdAt }));
    expect(observed.publish).toHaveBeenCalledTimes(2);
    observed.update(create(ConnectionSchema, { ...row(3500n, 7750n), createdAt }));
    expect(observed.publish).toHaveBeenLastCalledWith(expect.objectContaining({ upload: 500, download: 750 }));
    observed.stop();
  },
);
