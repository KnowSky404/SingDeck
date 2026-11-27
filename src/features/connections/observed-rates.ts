import type { InstanceSession } from "@/api/session";
import { hasCurrentConnections } from "@/api/state";
import type { Connection } from "@/proto/daemon/started_service_pb";
import { hasConnectionIntervalDelta } from "./traffic";

interface ConnectionObservation {
  record: Connection;
  connectionGeneration: number;
  topologyGeneration: number;
}

export interface ConnectionRateMeasurement extends ConnectionObservation {
  upload: number;
  download: number;
}

export function observeConnectionRates(
  session: Pick<InstanceSession, "getSnapshot" | "subscribe" | "profile">,
  connectionId: string,
  publish: (measurement: ConnectionRateMeasurement | null) => void,
) {
  const interval = session.profile.preferences.intervalMs;
  const expiresAfter = 2 * interval;
  let seen: ConnectionObservation | undefined;
  let sampledAt: number | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  function clearMeasurement() {
    if (expiry === undefined) return;
    clearTimeout(expiry);
    expiry = undefined;
    publish(null);
  }

  function clearSamples() {
    sampledAt = undefined;
    clearMeasurement();
  }

  function observe() {
    const snapshot = session.getSnapshot();
    const record = snapshot.connections.get(connectionId);
    if (document.hidden || !snapshot.serviceActionsReady || snapshot.authenticationFailed ||
      snapshot.detailChannel !== "connections" || !hasCurrentConnections(snapshot) ||
      !connectionId || !record || record.id !== connectionId || record.createdAt <= 0n || record.closedAt !== 0n) {
      seen = undefined;
      clearSamples();
      return;
    }
    const previous = seen;
    const { connectionGeneration, topologyGeneration } = snapshot;
    const sameScope = previous?.connectionGeneration === connectionGeneration &&
      previous.topologyGeneration === topologyGeneration && previous.record.createdAt === record.createdAt;
    if (sameScope && previous.record === record) return;

    // A retained row seeds identity only. Timing starts with the next published counter change.
    seen = { record, connectionGeneration, topologyGeneration };
    if (!sameScope || !hasConnectionIntervalDelta(record) ||
      record.uplinkTotal < record.uplink || record.downlinkTotal < record.downlink) {
      clearSamples();
      return;
    }
    const now = performance.now();
    const previousSampleAt = sampledAt;
    sampledAt = now;
    if (previousSampleAt === undefined) return;

    const uploadBytes = record.uplinkTotal - previous.record.uplinkTotal;
    const downloadBytes = record.downlinkTotal - previous.record.downlinkTotal;
    if (uploadBytes < record.uplink || downloadBytes < record.downlink) {
      clearSamples();
      return;
    }
    const elapsed = now - previousSampleAt;
    // Coalesced deliveries and long gaps do not describe a fresh observation interval.
    if (elapsed < interval / 2 || elapsed >= expiresAfter) {
      clearMeasurement();
      return;
    }
    clearTimeout(expiry);
    expiry = setTimeout(clearSamples, expiresAfter);
    publish({
      ...seen,
      upload: Number(uploadBytes) * 1000 / elapsed,
      download: Number(downloadBytes) * 1000 / elapsed,
    });
  }

  function visibilityChanged() {
    seen = undefined;
    observe();
  }

  const unsubscribe = session.subscribe(observe);
  document.addEventListener("visibilitychange", visibilityChanged);
  observe();
  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", visibilityChanged);
    clearTimeout(expiry);
  };
}
