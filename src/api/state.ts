import { initialCapabilities, type Capabilities } from "./capabilities";
import { plainLog } from "@/lib/ansi";
import { create } from "@bufbuild/protobuf";
import {
  ConnectionSchema,
  ConnectionEventType,
  type Connection,
  type ConnectionEvents,
  type Log,
  type LogLevel,
  type Version,
  type Status,
  type ServiceStatus,
  type Group,
  type GroupItem,
  type DeprecatedWarning,
} from "@/proto/daemon/started_service_pb";
import type { RuntimeObservation } from "./runtime";

export const LOG_LIMIT = 2000;
export const CONNECTION_LIMIT = 10000;
export interface LogEntry {
  id: number;
  receivedAt: number;
  level: LogLevel;
  message: string;
  text: string;
}
export type Channel = "service" | "status" | "groups" | "outbounds" | "logs" | "connections";
export interface Snapshot {
  phase: "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
  error?: string;
  authenticationFailed?: boolean;
  version?: Version;
  service?: ServiceStatus;
  serviceActionsReady: boolean;
  topologyGeneration: number;
  status?: Status;
  startedAt?: bigint;
  defaultLogLevel?: LogLevel;
  groups?: Group[];
  outbounds?: GroupItem[];
  capabilities: Capabilities;
  warnings?: DeprecatedWarning[];
  checkingWarnings?: boolean;
  testingLatencies?: boolean;
  latencyTestSource?: "groups" | "outbounds";
  stoppingLatencyTests?: boolean;
  testingManualLatencies?: ReadonlySet<string>;
  latencyTestError?: string;
  latencyTestSent?: boolean;
  logs: LogEntry[];
  connections: ReadonlyMap<string, Connection>;
  connectionGeneration: number;
  connectionOverflow: boolean;
  runtime: RuntimeObservation;
  streamErrors: Partial<Record<Channel, string>>;
  loaded: Partial<Record<Channel, boolean>>;
}
export const initialSnapshot = (): Snapshot => ({
  phase: "disconnected",
  serviceActionsReady: false,
  topologyGeneration: 0,
  capabilities: initialCapabilities(),
  logs: [],
  connections: new Map(),
  connectionGeneration: 0,
  connectionOverflow: false,
  runtime: { samples: [], events: [], lastFrameAt: {} },
  streamErrors: {},
  loaded: {},
});

export function hasCurrentConnections(snapshot: Snapshot) {
  return snapshot.phase === "connected" &&
    snapshot.loaded.connections === true &&
    !snapshot.streamErrors.connections;
}

export function hasCurrentLogs(snapshot: Snapshot) {
  return snapshot.phase === "connected" &&
    snapshot.loaded.logs === true &&
    !snapshot.authenticationFailed &&
    !snapshot.streamErrors.logs;
}

export function appendLogs(
  current: LogEntry[],
  batch: Log,
  sequence: { value: number },
  now: number,
  secret = "",
): LogEntry[] {
  const base = batch.reset ? [] : current;
  return [
    ...base,
    ...batch.messages.slice(-LOG_LIMIT).map((m) => {
      const plain = plainLog(m.message);
      // Formatting can split a token; redact the visible text before it reaches any view.
      const safe =
        secret && plain.includes(secret)
          ? plain.split(secret).join("[redacted]")
          : secret
            ? m.message.split(secret).join("[redacted]")
            : m.message;
      const message = safe.slice(0, 16384);
      return {
        id: ++sequence.value,
        receivedAt: now,
        level: m.level,
        message,
        text: plainLog(message),
      };
    }),
  ].slice(-LOG_LIMIT);
}

export function applyConnections(
  current: ReadonlyMap<string, Connection>,
  batch: ConnectionEvents,
): Map<string, Connection> {
  const next = batch.reset ? new Map<string, Connection>() : new Map(current);
  for (const e of batch.events) {
    if (
      e.type === ConnectionEventType.CONNECTION_EVENT_CLOSED ||
      (e.connection && e.connection.closedAt > 0n)
    ) {
      const row = e.connection ?? next.get(e.id);
      const closedAt = e.closedAt || row?.closedAt;
      if (row && closedAt && closedAt > 0n)
        next.set(
          e.id,
          create(ConnectionSchema, {
            ...row,
            closedAt,
            uplink: 0n,
            downlink: 0n,
          }),
        );
      else next.delete(e.id);
    } else if (
      e.type === ConnectionEventType.CONNECTION_EVENT_NEW &&
      e.connection
    )
      next.set(e.id, e.connection);
    else if (e.type === ConnectionEventType.CONNECTION_EVENT_UPDATE) {
      const row = next.get(e.id);
      if (row && row.closedAt === 0n)
        next.set(
          e.id,
          create(ConnectionSchema, {
            ...row,
            uplink: e.uplinkDelta,
            downlink: e.downlinkDelta,
            uplinkTotal: row.uplinkTotal + e.uplinkDelta,
            downlinkTotal: row.downlinkTotal + e.downlinkDelta,
          }),
        );
    }
  }
  return next;
}

export function assertCompatible(version: Version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.version);
  if (
    version.apiVersion !== 4 ||
    !match ||
    Number(match[1]) < 1 ||
    (Number(match[1]) === 1 && Number(match[2]) < 14)
  ) {
    throw new CompatibilityError(
      "Unsupported API. SingDeck currently requires stable sing-box ≥1.14.0 with Service API 4.",
    );
  }
}
export class CompatibilityError extends Error {}
