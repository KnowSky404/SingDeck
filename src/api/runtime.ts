import type { ServiceStatus_Type, Status } from "@/proto/daemon/started_service_pb";
import type { Channel, Snapshot } from "./state";

const sampleWindowMs = 300_000;
const sampleLimit = 300;
const eventLimit = 60;
export const runtimeStaleIntervals = 3;

export function notificationStreamState(snapshot: Snapshot, streamsAborted: boolean) {
  if (snapshot.phase === "disconnected") return "Disconnected";
  const capability = snapshot.capabilities.notifications.status;
  if (streamsAborted || capability === "unsupported" || capability === "unavailable") return "Unavailable";
  if (snapshot.detailChannel !== "notifications") return "Inactive";
  if (snapshot.streamErrors.notifications) return "Interrupted";
  return snapshot.loaded.notifications ? "Event received" : "Awaiting event";
}

export interface RuntimeSample {
  time: number;
  memory: bigint;
  goroutines: number;
  connectionsIn?: number;
  connectionsOut?: number;
  up?: number;
  down?: number;
  gapBefore: boolean;
}

export type RuntimeEvent =
  | { time: number; kind: "service"; status: ServiceStatus_Type }
  | { time: number; kind: "restart"; startedAt: bigint }
  | { time: number; kind: "status-lost" | "status-resumed" };

export interface RuntimeObservation {
  samples: RuntimeSample[];
  events: RuntimeEvent[];
  lastFrameAt: Partial<Record<Channel, number>>;
  lastBoot?: bigint;
}

export function recordRuntimeEvent(runtime: RuntimeObservation, event: RuntimeEvent) {
  return { ...runtime, events: [...runtime.events, event].slice(-eventLimit) };
}

export function recordRuntimeSample(
  runtime: RuntimeObservation,
  status: Status,
  time: number,
  serviceRunning: boolean,
  gapBefore: boolean,
  rate?: { up: number; down: number },
) {
  const sample: RuntimeSample = {
    time,
    memory: status.memory,
    goroutines: status.goroutines,
    connectionsIn: status.trafficAvailable ? status.connectionsIn : undefined,
    connectionsOut:
      status.connectionsOut > 0 || serviceRunning || status.trafficAvailable
        ? status.connectionsOut
        : undefined,
    up: rate?.up,
    down: rate?.down,
    gapBefore: gapBefore && runtime.samples.length > 0,
  };
  return {
    ...runtime,
    samples: [...runtime.samples, sample]
      .filter(({ time: observed }) => observed >= time - sampleWindowMs)
      .slice(-sampleLimit),
  };
}
