import { create } from "@bufbuild/protobuf";
import { expect, it } from "vitest";
import { applyConnections } from "@/api/state";
import { hasConnectionIntervalDelta } from "@/features/connections/traffic";
import {
  ConnectionEventsSchema,
  ConnectionEventType,
} from "@/proto/daemon/started_service_pb";

it("recognizes live native interval bytes after an update and clears them on a zero marker or close", () => {
  const id = "connection";
  const snapshot = applyConnections(new Map(), create(ConnectionEventsSchema, {
    reset: true,
    events: [{
      id,
      type: ConnectionEventType.CONNECTION_EVENT_NEW,
      connection: { id, uplinkTotal: 128n },
    }],
  }));
  expect(hasConnectionIntervalDelta(snapshot.get(id)!)).toBe(false);

  const update = (uplinkDelta: bigint) => create(ConnectionEventsSchema, {
    events: [{ id, type: ConnectionEventType.CONNECTION_EVENT_UPDATE, uplinkDelta }],
  });
  const measured = applyConnections(snapshot, update(64n));
  expect(measured.get(id)).toMatchObject({ uplink: 64n, downlink: 0n, uplinkTotal: 192n });
  expect(hasConnectionIntervalDelta(measured.get(id)!)).toBe(true);
  expect(hasConnectionIntervalDelta(applyConnections(measured, update(0n)).get(id)!)).toBe(false);
  expect(hasConnectionIntervalDelta(applyConnections(measured, update(-1n)).get(id)!)).toBe(false);

  const closed = applyConnections(measured, create(ConnectionEventsSchema, {
    events: [{ id, type: ConnectionEventType.CONNECTION_EVENT_CLOSED, closedAt: 100n }],
  }));
  expect(hasConnectionIntervalDelta(closed.get(id)!)).toBe(false);
});
