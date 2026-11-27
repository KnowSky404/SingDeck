import type { Connection } from "@/proto/daemon/started_service_pb";

export function hasConnectionIntervalDelta(connection: Connection) {
  const { closedAt, uplink, downlink } = connection;
  // Snapshot defaults and idle or reset markers are indistinguishable at zero.
  return closedAt === 0n && uplink >= 0n && downlink >= 0n &&
    (uplink > 0n || downlink > 0n);
}
