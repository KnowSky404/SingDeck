import { Code, ConnectError } from "@connectrpc/connect";
import {
  ServiceStatus_Type,
  type Version,
  type DeprecatedWarning,
  type Group,
  type GroupItem,
} from "@/proto/daemon/started_service_pb";
import { normalizeBearerToken, redactSecret, type SingBoxClient } from "./client";
import {
  capabilityFailure,
  initialCapabilities,
  type Capability,
  type CapabilityName,
} from "./capabilities";
import { DiagnosticExecutionError } from "./diagnostics";
import type {
  DiagnosticName,
  DiagnosticProgress,
  NetworkQualityRequest,
  STUNRequest,
} from "./diagnostics";
import { canRetry, canRetryCode, CloseAllUnavailable, delay, describeError } from "./errors";
import { recordRuntimeEvent, recordRuntimeSample, runtimeStaleIntervals } from "./runtime";
import {
  appendLogs,
  applyConnections,
  assertCompatible,
  CompatibilityError,
  CONNECTION_LIMIT,
  hasCurrentConnections,
  hasCurrentLogs,
  initialSnapshot,
  type Channel,
  type DetailChannel,
  type Snapshot,
} from "./state";
import type { Profile } from "@/features/instances/profiles";
import {
  dismissNotification,
  receiveLocalNotification,
  receiveNativeNotification,
  safeNativeText,
  setNotificationRead,
  visibleNotifications,
  type LocalNotification,
  type NotificationRecord,
} from "./notifications";

const probeWindowMs = 15_250;
type MetadataValidation = { generation: number; error?: unknown };
type LatencyTestWave = {
  tags: string[];
  windows: number;
};
type ConnectionBatchGeneration = Pick<Snapshot, "connectionGeneration" | "topologyGeneration">;
export type ConnectionBatchSelection = Readonly<ConnectionBatchGeneration> & {
  readonly ids: readonly string[];
};
export type ConnectionBatchResult = {
  acknowledged: number;
  skipped: number;
  unacknowledged: number;
  unsent: number;
  error?: string;
};

const connectionBatchStale = "Connection records changed. Review the current filters and try again.";

function probeMembers(group: Group, groups: ReadonlyMap<string, Group>) {
  const pending = new Map(group.items.map((item) => [item.tag, item]));
  const members = new Map<string, GroupItem>();
  for (const [tag, item] of pending) {
    const nested = groups.get(tag);
    if (nested) {
      for (const child of nested.items) {
        if (!pending.has(child.tag)) pending.set(child.tag, child);
      }
    } else members.set(tag, item);
  }
  return members;
}

function hasStaleProbeHistory(
  tag: string,
  before: ReadonlyMap<string, Group>,
  after: ReadonlyMap<string, Group>,
) {
  const previous = before.get(tag);
  const current = after.get(tag);
  if (previous?.type !== "urltest" || current?.type !== "urltest") return false;
  const oldMembers = probeMembers(previous, before);
  const newMembers = probeMembers(current, after);
  if (oldMembers.size !== newMembers.size) return false;
  let hadHistory = false;
  for (const [member, item] of oldMembers) {
    const latest = newMembers.get(member);
    if (
      latest?.urlTestTime !== item.urlTestTime ||
      latest.urlTestDelay !== item.urlTestDelay
    )
      return false;
    hadHistory ||= item.urlTestTime !== 0n;
  }
  return hadHistory;
}

function mergeWarnings(
  previous: DeprecatedWarning[] | undefined,
  current: DeprecatedWarning[] | undefined,
) {
  const warnings = new Map<string, DeprecatedWarning>();
  for (const warning of [...(previous ?? []), ...(current ?? [])])
    warnings.set(JSON.stringify([warning.message, warning.deprecatedVersion]), warning);
  return [...warnings.values()];
}

const streamCapabilities: Partial<Record<Channel, CapabilityName>> = {
  outbounds: "outboundInventory",
  groups: "groupManagement",
  status: "runtimeMonitoring",
  notifications: "notifications",
  usbip: "usbip",
};

function usesServiceDetailScope(channel: DetailChannel) {
  return channel === "outbounds" || channel === "clashMode" || channel === "usbip";
}

function sameInventory(before: GroupItem[], after: GroupItem[]) {
  if (before === after) return true;
  if (before.length !== after.length) return false;
  const counts = new Map<string, number>();
  for (const { tag, type } of after) {
    const key = JSON.stringify([tag, type]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return before.every(({ tag, type }) => {
    const key = JSON.stringify([tag, type]);
    const count = counts.get(key) ?? 0;
    if (count === 0) return false;
    counts.set(key, count - 1);
    return true;
  });
}

function sameGroupTopology(before: Group[], after: Group[]) {
  if (before === after) return true;
  if (before.length !== after.length) return false;
  const current = new Map(after.map((group) => [group.tag, group]));
  return before.every(({ tag, type, items }) => {
    const group = current.get(tag);
    if (group?.type !== type || group.items.length !== items.length) return false;
    return items.every(
      (item, index) =>
        group.items[index].tag === item.tag && group.items[index].type === item.type,
    );
  });
}

export class InstanceSession {
  private snapshot = initialSnapshot();
  private visibleVersion?: { reported: Version; display: Version };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private pending = initialSnapshot();
  private logSequence = { value: 0 };
  private notificationSequence = 0;
  private notificationHistory: NotificationRecord[] = [];
  private latencyTest?: {
    controller: AbortController;
    promise: Promise<void>;
    source: "groups" | "outbounds";
  };
  private latencyCooldown = new AbortController();
  private serviceReadsScope?: AbortController;
  private topologyGeneration = 0;
  private detailScope?: AbortController;
  private detailChannel: DetailChannel = "connections";
  private clashModeProbe?: AbortSignal;
  private clashModeChange?: AbortController;
  private retainClosedOnResume = false;
  private streamsStarted = false;
  private revalidation?: { controller: AbortController; promise: Promise<void> };
  private readonly versionReads = new Map<AbortSignal, (() => void) | undefined>();
  private revalidationGeneration = 0;
  private serviceRecoveryGeneration?: number;
  private bootScope?: AbortController;
  private checkingBoot = false;
  private lastBootMarker?: bigint;
  private runtimeGapPending = false;
  private warningArchive?: DeprecatedWarning[];
  private provisionalWarnings = false;
  private warningsScope?: AbortController;
  private archivedWarningScope?: AbortController;
  private retryWarningsAfterCurrent = false;
  private diagnosticScope?: AbortController;
  private connectionBatch?: ConnectionBatchGeneration & { scope: AbortController };

  private readonly secret: string;

  constructor(
    readonly client: SingBoxClient,
    readonly profile: Profile,
    secret = "",
  ) {
    this.secret = normalizeBearerToken(secret);
  }
  getSnapshot = () => this.snapshot;
  getOutboundTopology() {
    const { groups, outbounds, streamErrors } = this.pending;
    return {
      groups: streamErrors.groups ? undefined : groups,
      outbounds: streamErrors.outbounds ? undefined : outbounds,
      topologyGeneration: this.topologyGeneration,
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<Snapshot>, immediate = false) {
    const previous = this.pending;
    this.pending = { ...this.pending, ...patch };
    if (patch.phase === "error" && this.detailChannel === "usbip") {
      this.detailScope?.abort();
      this.pending.usbipServers = undefined;
      this.pending.loaded = { ...this.pending.loaded, usbip: false };
    }
    if ((patch.error && patch.error !== previous.error) || (patch.authenticationFailed && !previous.authenticationFailed))
      this.appendLocalNotification("apiConnection");
    if (patch.service?.status === ServiceStatus_Type.FATAL && previous.service?.status !== ServiceStatus_Type.FATAL)
      this.appendLocalNotification("serviceFatal");
    if (this.latencyTest && !this.canTestLatencyBatch(this.latencyTest.source))
      this.latencyTest.controller.abort();
    if (this.connectionBatch && !this.canCloseConnectionBatch(this.connectionBatch))
      this.connectionBatch.scope.abort();
    if (this.clashModeChange && !this.canChangeClashMode())
      this.clashModeChange.abort(new ConnectError("Mode confirmation interrupted", Code.Unavailable));
    if (!this.canRunServiceAction()) this.interruptDiagnostic();
    if (immediate) this.flush();
    else this.flushTimer ??= setTimeout(() => this.flush(), 100);
  }
  private flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    // Lifecycle comparisons use the reported version. Views consume the masked value.
    const version = this.pending.version;
    if (version !== this.visibleVersion?.reported) {
      this.visibleVersion = version && {
        reported: version,
        display: { ...version, version: this.redactText(version.version) },
      };
    }
    this.snapshot = {
      ...this.pending,
      version: this.visibleVersion?.display,
      serviceActionsReady: this.canRunServiceAction(),
      topologyGeneration: this.topologyGeneration,
      detailChannel: this.detailChannel,
    };
    this.listeners.forEach((listener) => listener());
  }
  private appendLocalNotification(kind: LocalNotification) {
    this.pending.notifications = this.setNotificationHistory(receiveLocalNotification(
      this.notificationHistory, kind, Date.now(), ++this.notificationSequence,
    ));
  }
  private setNotificationHistory(history: NotificationRecord[]) {
    this.notificationHistory = history;
    return visibleNotifications(history);
  }
  private notify(kind: LocalNotification) {
    this.appendLocalNotification(kind);
    this.update({});
  }
  markNotificationRead = (read: boolean, id?: string) => {
    this.update({ notifications: this.setNotificationHistory(setNotificationRead(this.notificationHistory, read, id)) }, true);
  };
  dismissNotification = (id: string) => {
    this.update({ notifications: this.setNotificationHistory(dismissNotification(this.notificationHistory, id)) }, true);
  };
  connect = () => {
    this.disconnect();
    this.pending = initialSnapshot();
    this.update({ phase: "connecting" }, true);
    const scope = new AbortController();
    this.controller = scope;
    scope.signal.addEventListener("abort", () => this.latencyCooldown.abort(), {
      once: true,
    });
    void this.start(scope.signal);
  };
  disconnect = () => {
    this.controller?.abort();
    this.versionReads.clear();
    this.notificationHistory = [];
    this.topologyGeneration++;
    this.streamsStarted = false;
    this.retainClosedOnResume = false;
    this.lastBootMarker = undefined;
    this.runtimeGapPending = false;
    this.warningArchive = undefined;
    this.provisionalWarnings = false;
    this.cancelRevalidation();
    this.detailScope = undefined;
    this.clashModeProbe = undefined;
    this.clashModeChange = undefined;
    this.cancelWarningRead();
    this.serviceReadsScope = undefined;
    this.diagnosticScope = undefined;
    this.resetLatencyTests();
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.pending = initialSnapshot();
    this.update({}, true);
  };
  private resetLatencyTests() {
    this.latencyTest?.controller.abort();
    this.latencyCooldown.abort();
    this.latencyCooldown = new AbortController();
    this.latencyTest = undefined;
  }
  private setCapability(name: CapabilityName, next: Capability) {
    const current = this.pending.capabilities[name];
    if (current.status === next.status && current.code === next.code) return;
    this.update({ capabilities: { ...this.pending.capabilities, [name]: next } });
  }
  private canRunServiceAction() {
    return (
      this.pending.phase === "connected" &&
      this.pending.service?.status === ServiceStatus_Type.STARTED &&
      !this.pending.streamErrors.service &&
      !this.revalidation && this.serviceRecoveryGeneration === undefined && !this.checkingBoot
    );
  }
  private interruptDiagnostic() {
    this.diagnosticScope?.abort(new ConnectError("Service interrupted", Code.Unavailable));
  }
  private invalidateServiceReads(keepWarnings = false) {
    this.topologyGeneration++;
    this.lastBootMarker = undefined;
    this.warningArchive = undefined;
    this.provisionalWarnings = false;
    this.serviceReadsScope?.abort();
    this.serviceReadsScope = undefined;
    const keepWarningRead = keepWarnings && !this.archivedWarningScope;
    if (!keepWarningRead) this.cancelWarningRead();
    this.interruptDiagnostic();
    this.retainClosedOnResume = false;
    this.update({
      connections: new Map(),
      connectionOverflow: false,
      groups: undefined,
      outbounds: undefined,
      clashModeOptions: undefined,
      currentClashMode: undefined,
      usbipServers: undefined,
      ...(!keepWarnings && { warnings: undefined }),
      ...(!keepWarningRead && { checkingWarnings: undefined }),
      capabilities: {
        ...initialCapabilities(),
        notifications: this.pending.capabilities.notifications,
        ...(keepWarnings && { deprecatedWarnings: this.pending.capabilities.deprecatedWarnings }),
      },
      loaded: { ...this.pending.loaded, connections: false, groups: false, outbounds: false, clashMode: false, usbip: false },
      streamErrors: {
        ...this.pending.streamErrors,
        groups: undefined,
        outbounds: undefined,
        clashMode: undefined,
        usbip: undefined,
      },
    });
    if (this.detailChannel === "connections") this.startDetailStream();
  }
  private async refreshServiceReads(parent: AbortSignal) {
    const scope = new AbortController();
    this.serviceReadsScope = scope;
    const signal = AbortSignal.any([parent, scope.signal]);
    if (usesServiceDetailScope(this.detailChannel)) this.startDetailStream();
    this.readServiceConfiguration();
    await this.stream("groups", signal);
  }
  setInventoryEnabled = (enabled: boolean) => {
    if (!enabled && this.detailChannel !== "outbounds") return;
    this.setDetailChannel(enabled ? "outbounds" : "connections");
  };
  setDetailChannel = (channel: DetailChannel) => {
    if (channel === this.detailChannel) return;
    if (this.detailChannel === "connections") {
      this.retainClosedOnResume = (this.retainClosedOnResume || this.pending.loaded.connections === true) &&
        this.lastBootMarker !== undefined && this.canRunServiceAction();
    }
    this.detailChannel = channel;
    this.detailScope?.abort();
    this.update({
      outbounds: undefined,
      usbipServers: undefined,
      loaded: { ...this.pending.loaded, connections: false, outbounds: false, clashMode: false, notifications: false, usbip: false },
      streamErrors: {
        ...this.pending.streamErrors,
        connections: undefined,
        outbounds: undefined,
        clashMode: undefined,
        notifications: undefined,
        usbip: undefined,
      },
    }, true);
    this.startDetailStream();
  };
  private startDetailStream() {
    const parent = this.signal;
    if (!parent || parent.aborted || !this.streamsStarted) return;
    const channel = this.detailChannel;
    if (channel === "usbip" && this.pending.phase === "error") return;
    const service = usesServiceDetailScope(channel) ? this.serviceReadsScope?.signal : parent;
    if (!service || service.aborted) return;
    // Keep a request slot free on native HTTP/1.1 origins with a six-socket limit.
    this.detailScope?.abort();
    const scope = new AbortController();
    this.detailScope = scope;
    void this.stream(channel, AbortSignal.any([parent, service, scope.signal]));
  }
  redactText(value: string) {
    return redactSecret(value, this.secret);
  }
  private readServiceConfiguration() {
    const parent = this.signal;
    const service = this.serviceReadsScope?.signal;
    if (!parent || !service || this.pending.service?.status !== ServiceStatus_Type.STARTED)
      return;
    if (this.warningReadNeedsRetry()) void this.refreshWarnings();
    void this.probeClashMode(AbortSignal.any([parent, service]));
  }
  get canRefreshWarnings() {
    return this.canRunServiceAction();
  }
  refreshWarnings = async () => {
    if (!this.canRefreshWarnings) return;
    const parent = this.signal;
    const service = this.serviceReadsScope?.signal;
    if (!parent || parent.aborted || !service || service.aborted || this.warningsScope) return;
    const scope = new AbortController();
    this.warningsScope = scope;
    const signal = AbortSignal.any([parent, scope.signal]);
    this.update({ checkingWarnings: true });
    try {
      const data = await this.runUnary(
        (options) => this.client.getDeprecatedWarnings({}, options),
        signal,
      );
      if (signal.aborted) return;
      const redact = (value: string) => this.redactText(value);
      const warnings = data.warnings.map((warning) => {
        const redacted = {
          ...warning,
          message: redact(warning.message),
          description: redact(warning.description),
          deprecatedVersion: redact(warning.deprecatedVersion),
          scheduledVersion: redact(warning.scheduledVersion),
          migrationLink: redact(warning.migrationLink),
        };
        // Some cores may send escaped fragments. The view rejects a redacted or nonofficial URL.
        try {
          const decoded = decodeURIComponent(redacted.migrationLink);
          if (redact(decoded) !== decoded) redacted.migrationLink = "";
        } catch {
          redacted.migrationLink = "";
        }
        return redacted;
      });
      // Daemon mode drains its warning collector on read.
      const previous = this.archivedWarningScope === scope ? this.warningArchive : this.pending.warnings;
      const combined = mergeWarnings(previous, warnings);
      if (combined.length > (previous?.length ?? 0)) this.notify("configuration");
      if (this.archivedWarningScope === scope) {
        this.warningArchive = combined;
      } else {
        this.update({ warnings: combined });
        this.setCapability("deprecatedWarnings", { status: "supported" });
      }
    } catch (error) {
      if (!signal.aborted && this.archivedWarningScope !== scope)
        this.setCapability("deprecatedWarnings", capabilityFailure(error));
    } finally {
      if (this.warningsScope === scope) {
        this.warningsScope = undefined;
        if (this.archivedWarningScope === scope) this.archivedWarningScope = undefined;
        const retry = this.retryWarningsAfterCurrent;
        this.retryWarningsAfterCurrent = false;
        if (!signal.aborted) {
          this.update({ checkingWarnings: false }, true);
          if (retry && this.warningReadNeedsRetry()) void this.refreshWarnings();
        }
      }
    }
  };
  private async probeClashMode(signal: AbortSignal) {
    if (this.clashModeProbe && !this.clashModeProbe.aborted) return;
    this.clashModeProbe = signal;
    let attempt = 0;
    try {
      while (!signal.aborted) {
        try {
          const { modeList, currentMode } = await this.runUnary(
            (options) => this.client.getClashModeStatus({}, options), signal,
          );
          if (signal.aborted) return;
          this.update({
            clashModeOptions: [...new Set(modeList.filter((mode) => this.safeClashMode(mode)))],
            ...(!this.pending.loaded.clashMode && {
              currentClashMode: this.safeClashMode(currentMode),
            }),
          });
          this.setCapability("clashMode", { status: "supported" });
          return;
        } catch (error) {
          if (signal.aborted) return;
          this.clearClashMode(error);
          if (!this.profile.preferences.autoReconnect || !canRetry(error)) return;
        }
        try {
          await delay(Math.min(1000 * 2 ** attempt++, 30000), signal);
        } catch {
          return;
        }
      }
    } finally {
      if (this.clashModeProbe === signal) this.clashModeProbe = undefined;
    }
  }
  private clearClashMode(error: unknown) {
    this.update({ clashModeOptions: undefined, currentClashMode: undefined });
    this.setCapability("clashMode", capabilityFailure(error));
  }
  private safeClashMode(mode: string) {
    return mode && this.redactText(mode) === mode ? mode : undefined;
  }
  private versionChanged(next: Version) {
    const { version } = this.pending;
    return version?.version !== next.version || version?.apiVersion !== next.apiVersion;
  }
  clearLogs = () => this.update({ logs: [] }, true);
  clearCoreLogs = async () => {
    const signal = this.signal;
    if (!signal || signal.aborted || !hasCurrentLogs(this.pending))
      throw new ConnectError("Log stream unavailable", Code.Unavailable);
    return this.runUnary((options) => this.client.clearLogs({}, options), signal);
  };
  private async readVersion(signal: AbortSignal, reportRejection = true) {
    signal.throwIfAborted();
    const session = this.signal;
    this.versionReads.set(signal, undefined);
    try {
      return await this.client.getVersion({}, { signal });
    } catch (error) {
      if (reportRejection && !signal.aborted && session === this.signal && !this.pending.authenticationFailed &&
          ConnectError.from(error).code === Code.Unauthenticated)
        this.update({ authenticationFailed: true }, true);
      throw error;
    } finally {
      const fallback = this.versionReads.get(signal);
      if (fallback) signal.removeEventListener("abort", fallback);
      this.versionReads.delete(signal);
    }
  }
  private confirmCredentialRejection() {
    const signal = this.signal;
    if (!signal || signal.aborted || this.pending.authenticationFailed || this.versionReads.has(signal)) return;
    const confirm = () => {
      if (signal === this.signal && !signal.aborted && !this.pending.authenticationFailed && !this.versionReads.has(signal))
        void this.readVersion(signal).catch(() => {});
    };
    const reused = [...this.versionReads.keys()].find((read) => !read.aborted);
    if (!reused) return confirm();
    if (this.versionReads.get(reused)) return;
    // A service reset may cancel this metadata read without ending the session.
    const fallback = () => {
      this.versionReads.delete(reused);
      confirm();
    };
    this.versionReads.set(reused, fallback);
    reused.addEventListener("abort", fallback, { once: true, signal });
  }
  private async readMetadata(signal: AbortSignal) {
    const version = await this.readVersion(signal, false);
    signal.throwIfAborted();
    assertCompatible(version);
    const level = await this.runUnary(
      (options) => this.client.getDefaultLogLevel({}, options), signal,
    ).catch(() => undefined);
    return { version, defaultLogLevel: level?.level };
  }
  private cancelBootRead() {
    this.bootScope?.abort();
    this.bootScope = undefined;
    this.checkingBoot = false;
  }
  private cancelRevalidation() {
    this.revalidationGeneration++;
    this.serviceRecoveryGeneration = undefined;
    this.cancelBootRead();
    this.revalidation?.controller.abort();
    this.revalidation = undefined;
  }
  private async revalidateMetadata(parent: AbortSignal, expectedGeneration?: number): Promise<MetadataValidation> {
    while (
      !parent.aborted && this.pending.phase !== "error" &&
      (expectedGeneration === undefined || expectedGeneration === this.revalidationGeneration)
    ) {
      const generation = this.revalidationGeneration;
      const current = this.revalidation ?? this.startRevalidation(parent);
      try {
        await current.promise;
      } catch (error) {
        if (!parent.aborted && generation === this.revalidationGeneration)
          return { generation, error };
        continue;
      }
      if (
        generation === this.revalidationGeneration &&
        !current.controller.signal.aborted &&
        (!this.revalidation || this.revalidation === current)
      ) return { generation };
    }
    return { generation: this.revalidationGeneration };
  }
  private startRevalidation(parent: AbortSignal) {
    this.cancelBootRead();
    const controller = new AbortController();
    const signal = AbortSignal.any([parent, controller.signal]);
    const promise = this.readMetadata(signal)
      .then((metadata) => {
        if (signal.aborted) return;
        const changed = this.versionChanged(metadata.version);
        this.update({
          ...metadata,
          ...(changed && { startedAt: undefined }),
        });
        if (changed) this.invalidateServiceReads();
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        if (ConnectError.from(error).code === Code.Unauthenticated)
          this.update({ authenticationFailed: true, error: describeError(error) }, true);
        throw error;
      })
      .finally(() => {
        if (this.revalidation?.controller === controller) this.revalidation = undefined;
      });
    this.revalidation = { controller, promise };
    return this.revalidation;
  }
  private async recoverServiceReads(signal: AbortSignal) {
    const generation = this.revalidationGeneration;
    if (this.pending.phase === "error" || this.serviceRecoveryGeneration === generation) return;
    this.serviceRecoveryGeneration = generation;
    let attempt = 0;
    try {
      while (!signal.aborted && generation === this.revalidationGeneration) {
        try {
          const validation = await this.revalidateMetadata(signal, generation);
          if (signal.aborted || generation !== this.revalidationGeneration) return;
          if ("error" in validation) throw validation.error;
          this.serviceRecoveryGeneration = undefined;
          this.resumeServiceReads(signal);
          return;
        } catch (error) {
          if (signal.aborted || generation !== this.revalidationGeneration) return;
          if (
            error instanceof CompatibilityError ||
            !this.profile.preferences.autoReconnect ||
            !canRetry(error)
          ) {
            this.controller?.abort();
            this.update({
              phase: "error",
              checkingWarnings: false,
              error: error instanceof CompatibilityError ? error.message : describeError(error),
            }, true);
            return;
          }
          try {
            await delay(Math.min(1000 * 2 ** attempt++, 30000), signal);
          } catch {
            return;
          }
        }
      }
    } finally {
      if (this.serviceRecoveryGeneration === generation) this.serviceRecoveryGeneration = undefined;
    }
  }
  private resumeServiceReads(parent: AbortSignal) {
    if (
      parent.aborted || this.bootScope || this.revalidation ||
      this.serviceRecoveryGeneration !== undefined ||
      this.pending.phase !== "connected" ||
      this.pending.service?.status !== ServiceStatus_Type.STARTED
    ) return;
    const scope = new AbortController();
    this.bootScope = scope;
    this.checkingBoot = true;
    const signal = AbortSignal.any([parent, scope.signal]);
    if (!this.serviceReadsScope) void this.refreshServiceReads(parent);
    else if (this.pending.capabilities.clashMode.status === "unknown")
      this.readServiceConfiguration();
    void this.refreshBootMarker(parent, signal, scope);
  }
  private async refreshBootMarker(parent: AbortSignal, signal: AbortSignal, scope: AbortController) {
    let attempt = 0;
    try {
      while (!signal.aborted) {
        try {
          const { startedAt } = await this.runUnary(
            (options) => this.client.getStartedAt({}, { ...options, timeoutMs: 2000 }),
            signal,
          );
          if (signal.aborted) return;
          if (startedAt <= 0n) throw new ConnectError("Boot marker unavailable", Code.Unavailable);
          this.confirmBootMarker(startedAt);
          return;
        } catch (error) {
          if (signal.aborted) return;
          const retry = this.profile.preferences.autoReconnect && canRetry(error);
          // Two bounded attempts give warning reads a path even when uptime stays unavailable.
          if (!retry || attempt === 1) this.releaseBootCheck(parent, true);
          if (!retry) return;
          try {
            await delay(Math.min(1000 * 2 ** attempt++, 30000), signal);
          } catch {
            return;
          }
        }
      }
    } finally {
      if (this.bootScope === scope) {
        this.bootScope = undefined;
        if (signal.aborted) this.checkingBoot = false;
        else if (this.checkingBoot) this.releaseBootCheck(parent);
        else if (!this.serviceReadsScope) void this.refreshServiceReads(parent);
      }
    }
  }
  private confirmBootMarker(startedAt: bigint) {
    const previous = this.lastBootMarker;
    if (previous !== undefined && previous !== startedAt) {
      this.invalidateServiceReads(this.provisionalWarnings);
    } else if (previous === startedAt) {
      if (this.warningArchive)
        this.update({ warnings: mergeWarnings(this.warningArchive, this.pending.warnings) });
    } else if (this.archivedWarningScope) {
      this.cancelWarningRead();
      this.update({ checkingWarnings: false });
    }
    this.archivedWarningScope = undefined;
    this.lastBootMarker = startedAt;
    this.warningArchive = undefined;
    this.provisionalWarnings = false;
    const runtime = this.pending.runtime;
    const restarted = runtime.lastBoot !== undefined && runtime.lastBoot !== startedAt;
    if (restarted) this.runtimeGapPending = true;
    this.update({
      startedAt,
      runtime: {
        ...(restarted ? recordRuntimeEvent(runtime, { time: Date.now(), kind: "restart", startedAt }) : runtime),
        lastBoot: startedAt,
      },
    });
  }
  private releaseBootCheck(parent: AbortSignal, unconfirmed = false) {
    if (!this.checkingBoot) return;
    this.checkingBoot = false;
    if (unconfirmed) {
      if (!this.provisionalWarnings) {
        this.archiveWarnings();
        this.provisionalWarnings = true;
        this.update({ startedAt: undefined });
      }
      this.requireFreshTopology();
    }
    if (this.warningsScope) this.retryWarningsAfterCurrent = true;
    if (!this.serviceReadsScope) void this.refreshServiceReads(parent);
    else if (!this.warningsScope && this.warningReadNeedsRetry()) void this.refreshWarnings();
    this.update({});
  }
  private requireFreshTopology() {
    // The replacement snapshot establishes the connection history after an uncertain gap.
    this.topologyGeneration++;
    this.serviceReadsScope?.abort();
    this.serviceReadsScope = undefined;
    this.retainClosedOnResume = false;
    this.update({
      groups: undefined,
      outbounds: undefined,
      clashModeOptions: undefined,
      currentClashMode: undefined,
      usbipServers: undefined,
      capabilities: {
        ...this.pending.capabilities,
        clashMode: { status: "unknown" },
        usbip: { status: "unknown" },
      },
      loaded: { ...this.pending.loaded, groups: false, outbounds: false, connections: false, clashMode: false, usbip: false },
      streamErrors: { ...this.pending.streamErrors, usbip: undefined },
    });
    if (this.detailChannel === "connections") this.startDetailStream();
  }
  private archiveWarnings() {
    if (this.pending.warnings)
      this.warningArchive = mergeWarnings(this.warningArchive, this.pending.warnings);
    this.archivedWarningScope = this.warningsScope;
    this.update({
      warnings: undefined,
      capabilities: {
        ...this.pending.capabilities,
        deprecatedWarnings: { status: "unknown" },
      },
    });
  }
  private cancelWarningRead() {
    this.warningsScope?.abort();
    this.warningsScope = undefined;
    this.archivedWarningScope = undefined;
    this.retryWarningsAfterCurrent = false;
  }
  private warningReadNeedsRetry() {
    const { status, code } = this.pending.capabilities.deprecatedWarnings;
    return status === "unknown" || (code !== undefined && canRetryCode(code));
  }
  private async start(signal: AbortSignal) {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        // Publish an initial rejection together with the terminal connection error.
        const metadata = await this.readMetadata(signal);
        if (signal.aborted) return;
        this.update({ ...metadata, error: undefined });
        this.streamsStarted = true;
        void this.refreshServiceReads(signal);
        if (!usesServiceDetailScope(this.detailChannel)) this.startDetailStream();
        await Promise.all(
          (["service", "status", "logs"] as const).map(
            (channel) => this.stream(channel, signal),
          ),
        );
        return;
      } catch (error) {
        if (signal.aborted) return;
        const message =
          error instanceof CompatibilityError
            ? error.message
            : describeError(error);
        if (
          !this.profile.preferences.autoReconnect ||
          !canRetry(error) ||
          error instanceof CompatibilityError
        ) {
          this.update(
            {
              phase: "error",
              error: message,
              ...(!this.streamsStarted && ConnectError.from(error).code === Code.Unauthenticated && {
                authenticationFailed: true,
              }),
            },
            true,
          );
          return;
        }
        this.update({ phase: "reconnecting", error: message }, true);
        try {
          await delay(Math.min(1000 * 2 ** attempt++, 30000), signal);
        } catch {
          return;
        }
      }
    }
  }
  private async stream(channel: Channel, parentSignal: AbortSignal) {
    let attempt = 0;
    while (!parentSignal.aborted) {
      const scope = new AbortController();
      const stop = () => scope.abort();
      parentSignal.addEventListener("abort", stop, { once: true });
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const refreshWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(
          () =>
            scope.abort(new ConnectError("Status idle", Code.DeadlineExceeded)),
          this.profile.preferences.intervalMs * 4 + 5000,
        );
      };
      try {
        const options = { signal: scope.signal };
        const request = {
          interval: BigInt(this.profile.preferences.intervalMs) * 1_000_000n,
        };
        // Each stream keeps its generated message type inside its own loop.
        const received = () => {
          const now = Date.now();
          attempt = 0;
          const capability = streamCapabilities[channel];
          if (capability) this.setCapability(capability, { status: "supported" });
          this.update({
            runtime: {
              ...this.pending.runtime,
              lastFrameAt: { ...this.pending.runtime.lastFrameAt, [channel]: now },
            },
            loaded: { ...this.pending.loaded, [channel]: true },
            streamErrors: {
              ...this.pending.streamErrors,
              [channel]: undefined,
            },
          });
          return now;
        };
        if (channel === "status") {
          if (attempt > 0) {
            let validation = await this.revalidateMetadata(parentSignal);
            while (!parentSignal.aborted && validation.generation !== this.revalidationGeneration)
              validation = await this.revalidateMetadata(parentSignal);
            if (parentSignal.aborted) return;
            if ("error" in validation) throw validation.error;
          }
          refreshWatchdog();
          let first = true;
          for await (const status of this.client.subscribeStatus(
            request,
            options,
          )) {
            if (parentSignal.aborted) return;
            refreshWatchdog();
            const resumed = first && Boolean(this.pending.streamErrors.status);
            const previous = this.pending.status;
            const lastStatusAt = this.pending.runtime.lastFrameAt.status;
            const now = received();
            this.setCapability("trafficTracking", {
              status: status.trafficAvailable ? "supported" : "unavailable",
            });
            const seconds = this.profile.preferences.intervalMs / 1000;
            const resetTotals = status.trafficAvailable && previous?.trafficAvailable === true &&
              (status.uplinkTotal < previous.uplinkTotal || status.downlinkTotal < previous.downlinkTotal);
            const overdue = lastStatusAt !== undefined &&
              now - lastStatusAt > this.profile.preferences.intervalMs * runtimeStaleIntervals;
            const gap = first || this.runtimeGapPending || resetTotals || overdue;
            this.runtimeGapPending = false;
            const rate = status.trafficAvailable && previous?.trafficAvailable &&
              !gap && status.uplink >= 0n && status.downlink >= 0n
              ? { up: Number(status.uplink) / seconds, down: Number(status.downlink) / seconds }
              : undefined;
            const observations = resumed
              ? recordRuntimeEvent(this.pending.runtime, { time: now, kind: "status-resumed" })
              : this.pending.runtime;
            this.update({
              phase: "connected",
              error: undefined,
              status,
              runtime: recordRuntimeSample(
                observations,
                status,
                now,
                !this.pending.streamErrors.service &&
                  this.pending.service?.status === ServiceStatus_Type.STARTED,
                gap,
                rate,
              ),
            });
            if (first) this.resumeServiceReads(parentSignal);
            first = false;
          }
        } else if (channel === "service") {
          for await (const service of this.client.subscribeServiceStatus(
            {},
            options,
          )) {
            if (parentSignal.aborted) return;
            const recovering = Boolean(this.pending.streamErrors.service);
            const previous = this.pending.service?.status;
            const now = received();
            if (previous !== service.status) {
              if (previous !== undefined) this.runtimeGapPending = true;
              this.update({ runtime: recordRuntimeEvent(this.pending.runtime, {
                time: now, kind: "service", status: service.status,
              }) });
            }
            if (service.status === ServiceStatus_Type.STARTED) {
              this.update({ service });
              if (previous !== ServiceStatus_Type.STARTED) {
                // A metadata read started before readiness cannot establish this boot timestamp.
                this.cancelRevalidation();
                void this.recoverServiceReads(parentSignal);
              } else if (recovering) {
                this.requireFreshTopology();
                void this.recoverServiceReads(parentSignal);
              }
            } else {
              if (this.pending.service?.status !== service.status) {
                this.cancelRevalidation();
                this.invalidateServiceReads();
              }
              this.resetLatencyTests();
              this.update({
                service,
                startedAt: undefined,
                testingLatencies: undefined,
                latencyTestSource: undefined,
                stoppingLatencyTests: undefined,
                testingManualLatencies: undefined,
                latencyTestSent: undefined,
                latencyTestError: undefined,
              }, true);
            }
          }
        } else if (channel === "groups") {
          for await (const groups of this.client.subscribeGroups({}, options)) {
            if (parentSignal.aborted) return;
            received();
            this.update({ groups: groups.group });
          }
        } else if (channel === "outbounds") {
          for await (const inventory of this.client.subscribeOutbounds({}, options)) {
            if (parentSignal.aborted) return;
            received();
            this.update({ outbounds: inventory.outbounds });
          }
        } else if (channel === "clashMode") {
          for await (const { mode } of this.client.subscribeClashMode({}, options)) {
            if (parentSignal.aborted) return;
            received();
            this.update({
              currentClashMode: this.safeClashMode(mode),
              loaded: { ...this.pending.loaded, clashMode: Boolean(mode) },
            });
          }
        } else if (channel === "usbip") {
          for await (const { servers } of this.client.subscribeUSBIPServerStatus({}, options)) {
            if (parentSignal.aborted) return;
            if (this.pending.streamErrors.service) continue;
            received();
            this.update({
              usbipServers: servers.map(({ serverTag, devices }) => ({
                tag: safeNativeText(serverTag, (value) => this.redactText(value), 160),
                deviceCount: devices.length,
              })),
            });
          }
        } else if (channel === "logs") {
          for await (const log of this.client.subscribeLog({}, options)) {
            if (parentSignal.aborted) return;
            received();
            this.update({
              logs: appendLogs(
                this.pending.logs,
                log,
                this.logSequence,
                Date.now(),
                this.secret,
              ),
            });
          }
        } else if (channel === "notifications") {
          if (attempt > 0) this.update({
            loaded: { ...this.pending.loaded, notifications: false },
            streamErrors: { ...this.pending.streamErrors, notifications: undefined },
          });
          for await (const event of this.client.subscribeNotifications({}, options)) {
            if (parentSignal.aborted) return;
            if (!event.event.case) continue;
            received();
            this.update({ notifications: this.setNotificationHistory(receiveNativeNotification(
              this.notificationHistory, event, Date.now(), ++this.notificationSequence,
              (value) => this.redactText(value),
            )) });
          }
        } else {
          for await (const events of this.client.subscribeConnections(
            request,
            options,
          )) {
            if (parentSignal.aborted) return;
            received();
            const snapshot = applyConnections(this.pending.connections, events);
            const resume = events.reset && this.retainClosedOnResume;
            let connections = snapshot;
            if (resume) {
              // The core's reset replaces live rows but its closed buffer is shorter than ours.
              connections = new Map();
              for (const [id, row] of this.pending.connections) {
                if (row.closedAt > 0n && !snapshot.has(id)) connections.set(id, row);
              }
              for (const [id, row] of snapshot) connections.set(id, row);
              this.retainClosedOnResume = false;
            }
            const overflow = connections.size > CONNECTION_LIMIT;
            // Discard closed history before active rows when the bounded view is full.
            for (const [id, row] of connections) {
              if (connections.size <= CONNECTION_LIMIT) break;
              if (row.closedAt > 0n) connections.delete(id);
            }
            // shortcut: retain at most 10k records; use server filtering for larger instances.
            while (connections.size > CONNECTION_LIMIT)
              connections.delete(connections.keys().next().value!);
            this.update({
              connections,
              connectionGeneration: this.pending.connectionGeneration + Number(events.reset),
              connectionOverflow: events.reset
                ? overflow || (resume && this.pending.connectionOverflow)
                : this.pending.connectionOverflow || overflow,
            });
          }
        }
        throw new ConnectError("Stream ended", Code.Unavailable);
      } catch (caught) {
        if (parentSignal.aborted) return;
        const error =
          scope.signal.reason instanceof ConnectError
            ? scope.signal.reason
            : caught;
        const message =
          error instanceof CompatibilityError
            ? error.message
            : describeError(error);
        const capability = streamCapabilities[channel];
        if (capability) this.setCapability(capability, capabilityFailure(error));
        const { code } = ConnectError.from(error);
        if (channel === "clashMode" && (code === Code.NotFound || code === Code.Unimplemented))
          this.clearClashMode(error);
        if (channel === "status") this.setCapability("trafficTracking", capabilityFailure(error));
        if (channel === "status" || channel === "service") this.retainClosedOnResume = false;
        if (channel === "service") this.topologyGeneration++;
        if (channel === "service" && this.provisionalWarnings) {
          // Only the lifecycle subscription can establish continuity across status reconnects.
          this.archiveWarnings();
          this.provisionalWarnings = false;
        }
        const retry =
          this.profile.preferences.autoReconnect &&
          canRetry(error) &&
          !(error instanceof CompatibilityError);
        if (channel === "status" && !retry) {
          this.cancelRevalidation();
          this.cancelWarningRead();
        }
        if (error instanceof CompatibilityError) this.controller?.abort();
        this.update(
          {
            ...(channel === "status" && !this.pending.streamErrors.status && {
              runtime: recordRuntimeEvent(this.pending.runtime, { time: Date.now(), kind: "status-lost" }),
            }),
            ...((channel === "usbip" || channel === "service") && {
              usbipServers: undefined,
              loaded: { ...this.pending.loaded, usbip: false },
            }),
            streamErrors: { ...this.pending.streamErrors, [channel]: message },
            ...(channel === "status"
              ? { phase: retry ? "reconnecting" : "error", error: message,
                  ...(!retry && { checkingWarnings: false }) }
              : {}),
          },
          true,
        );
        if (code === Code.Unauthenticated) this.confirmCredentialRejection();
        if (!retry) return;
      } finally {
        clearTimeout(watchdog);
        parentSignal.removeEventListener("abort", stop);
        scope.abort();
      }
      try {
        await delay(Math.min(1000 * 2 ** attempt++, 30000), parentSignal);
      } catch {
        return;
      }
    }
  }
  get signal() {
    return this.controller?.signal;
  }
  private async runUnary<T>(
    request: (options: { signal?: AbortSignal }) => Promise<T>,
    signal = this.signal,
  ) {
    const session = this.signal;
    try {
      return await request({ signal });
    } catch (error) {
      if (
        signal &&
        !signal.aborted &&
        session === this.signal &&
        ConnectError.from(error).code === Code.Unauthenticated
      )
        this.confirmCredentialRejection();
      throw error;
    }
  }
  selectOutbound = async (groupTag: string, outboundTag: string) => {
    const signal = this.signal;
    if (!signal || signal.aborted)
      throw new ConnectError("Disconnected", Code.Canceled);
    try {
      await this.confirmOutboundSelection(groupTag, outboundTag, signal);
    } catch (error) {
      if (!signal.aborted && ConnectError.from(error).code !== Code.Canceled) this.notify("selectionFailed");
      throw error;
    }
  };
  private async confirmOutboundSelection(groupTag: string, outboundTag: string, signal: AbortSignal) {
    if (!this.canRunServiceAction() || !this.pending.groups || this.pending.streamErrors.groups)
      throw new ConnectError("Group state unavailable", Code.Unavailable);
    await this.runUnary((options) =>
      this.client.selectOutbound({ groupTag, outboundTag }, options),
    );
    return this.waitForConfirmation(signal, () => this.snapshot.groups?.some(
      (group) => group.tag === groupTag && group.selected === outboundTag,
    ) === true);
  };
  private waitForConfirmation(signal: AbortSignal, confirmed: () => boolean) {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        unsubscribe();
        signal.removeEventListener("abort", aborted);
      };
      const aborted = () => {
        cleanup();
        reject(signal.reason instanceof ConnectError
          ? signal.reason
          : new ConnectError("Canceled", Code.Canceled));
      };
      const check = () => {
        if (confirmed()) {
          cleanup();
          resolve();
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new ConnectError("Confirmation timed out", Code.DeadlineExceeded),
        );
      }, 8000);
      const unsubscribe = this.subscribe(check);
      if (signal.aborted) aborted();
      else {
        signal.addEventListener("abort", aborted, { once: true });
        check();
      }
    });
  }
  private canChangeClashMode() {
    return this.canRunServiceAction() &&
      this.detailChannel === "clashMode" &&
      this.pending.capabilities.clashMode.status === "supported" &&
      this.pending.loaded.clashMode === true && !this.pending.streamErrors.clashMode;
  }
  setClashMode = async (mode: string) => {
    const parent = this.signal;
    const service = this.serviceReadsScope?.signal;
    const detail = this.detailScope?.signal;
    if (!parent || !service || !detail || this.clashModeChange || !this.canChangeClashMode())
      throw new ConnectError("Mode state unavailable", Code.Unavailable);
    if (!this.pending.clashModeOptions?.includes(mode))
      throw new ConnectError("Mode not reported by the instance", Code.InvalidArgument);
    if (this.pending.currentClashMode === mode) return;
    const scope = new AbortController();
    const signal = AbortSignal.any([parent, service, detail, scope.signal]);
    signal.throwIfAborted();
    this.clashModeChange = scope;
    this.update({ changingClashMode: true }, true);
    try {
      await this.runUnary((options) => this.client.setClashMode({ mode }, options), signal);
      await this.waitForConfirmation(signal, () =>
        this.snapshot.loaded.clashMode === true && this.snapshot.currentClashMode === mode,
      );
    } catch (error) {
      const { code } = ConnectError.from(error);
      if (!signal.aborted && (code === Code.NotFound || code === Code.Unimplemented))
        this.clearClashMode(error);
      throw error;
    } finally {
      if (this.clashModeChange === scope) {
        this.clashModeChange = undefined;
        this.update({ changingClashMode: undefined }, true);
      }
    }
  };
  urlTest = async (outboundTag: string, signal = this.signal) => {
    if (!this.canRunServiceAction())
      throw new ConnectError("Service unavailable", Code.Canceled);
    try {
      await this.runUnary(
        (options) => this.client.uRLTest({ outboundTag }, options),
        signal,
      );
      if (!signal?.aborted) this.setCapability("urlTest", { status: "supported" });
    } catch (error) {
      const { code } = ConnectError.from(error);
      if (!signal?.aborted && code !== Code.NotFound && code !== Code.Canceled)
        this.setCapability("urlTest", capabilityFailure(error));
      throw error;
    }
  };
  private canTestLatencies(source: "groups" | "outbounds") {
    return (
      this.canRunServiceAction() &&
      this.pending[source] !== undefined &&
      !this.pending.streamErrors[source] &&
      this.pending.capabilities.urlTest.status !== "unsupported"
    );
  }
  private canTestLatencyBatch(source: "groups" | "outbounds") {
    return this.canTestLatencies("groups") &&
      (source === "groups" || this.canTestLatencies("outbounds"));
  }
  testLatency = (tag: string, windows: number, source: "groups" | "outbounds" = "groups") => {
    const signal = this.signal;
    const activeTags = this.pending.testingManualLatencies;
    if (!signal || signal.aborted || !this.canTestLatencies(source) ||
        this.latencyTest || activeTags?.has(tag))
      return Promise.reject(new ConnectError("Test unavailable", Code.Canceled));
    const cooldown = this.latencyCooldown.signal;
    this.update({ testingManualLatencies: new Set(activeTags).add(tag) }, true);
    const request = this.urlTest(tag, cooldown);
    void request
      .then(() => true, canRetry)
      .then(async (started) => {
        if (started && this.profile.mode === "native")
          await delay(probeWindowMs * windows, cooldown);
      })
      .catch(() => undefined)
      .finally(() => {
        if (cooldown.aborted) return;
        const remaining = new Set(this.pending.testingManualLatencies);
        remaining.delete(tag);
        this.update({ testingManualLatencies: remaining.size ? remaining : undefined }, true);
      });
    return request;
  };
  testInventory = (tags: string[], plannedOutbounds: GroupItem[]) => {
    const inventory = new Set(plannedOutbounds.map(({ tag }) => tag));
    const groups = new Set(this.pending.groups?.map(({ tag }) => tag));
    const queue = [...new Set(tags)].filter((tag) => inventory.has(tag) && !groups.has(tag));
    const waves: LatencyTestWave[] = [];
    for (let index = 0; index < queue.length; index += 10)
      waves.push({ tags: queue.slice(index, index + 10), windows: 3 });
    return this.testLatencies(waves, this.snapshot.groups ?? [], plannedOutbounds);
  };
  cancelLatencyTests = () => {
    const active = this.latencyTest;
    if (!active || active.controller.signal.aborted) return;
    active.controller.abort();
    this.update({ stoppingLatencyTests: true }, true);
  };
  testLatencies = (
    waves: LatencyTestWave[],
    plannedGroups = this.snapshot.groups ?? [],
    plannedOutbounds?: GroupItem[],
  ) => {
    if (this.latencyTest) return this.latencyTest.promise;
    const sessionSignal = this.signal;
    if (!sessionSignal || sessionSignal.aborted)
      return Promise.reject(new ConnectError("Disconnected", Code.Canceled));
    const source = plannedOutbounds === undefined ? "groups" : "outbounds";
    if (!this.canTestLatencyBatch(source) || this.pending.testingManualLatencies)
      return Promise.reject(new ConnectError("Service unavailable", Code.Canceled));
    const controller = new AbortController();
    const stop = () => controller.abort(sessionSignal.reason);
    sessionSignal.addEventListener("abort", stop, { once: true });
    const promise = this.runLatencyTests(
      waves,
      plannedGroups,
      controller.signal,
      this.latencyCooldown.signal,
      plannedOutbounds,
    )
      .then(() => {
        if (
          this.latencyTest?.controller === controller &&
          this.profile.mode === "native"
        )
          this.update({ latencyTestSent: true }, true);
      })
      .catch((error: unknown) => {
        if (
          this.latencyTest?.controller === controller &&
          !this.pending.stoppingLatencyTests
        )
          this.update({ latencyTestError: describeError(error) }, true);
        throw error;
      })
      .finally(() => {
        sessionSignal.removeEventListener("abort", stop);
        if (this.latencyTest?.controller !== controller) return;
        this.latencyTest = undefined;
        this.update({
          testingLatencies: undefined,
          latencyTestSource: undefined,
          stoppingLatencyTests: undefined,
        }, true);
      });
    this.latencyTest = { controller, promise, source };
    this.update(
      {
        testingLatencies: true,
        latencyTestSource: source,
        latencyTestError: undefined,
        latencyTestSent: undefined,
      },
      true,
    );
    return promise;
  };
  private async runLatencyTests(
    waves: LatencyTestWave[],
    plannedGroups: Group[],
    signal: AbortSignal,
    cooldown: AbortSignal,
    plannedOutbounds?: GroupItem[],
  ) {
    let failure: PromiseRejectedResult | undefined;
    const native = this.profile.mode === "native";
    const dispatch = async (tags: string[], windows: number) => {
      signal.throwIfAborted();
      if (
        !sameGroupTopology(plannedGroups, this.pending.groups ?? []) ||
        (plannedOutbounds && !sameInventory(plannedOutbounds, this.pending.outbounds ?? []))
      )
        throw new ConnectError("Outbound topology changed", Code.Canceled);
      const results = await Promise.allSettled(
        tags.map((tag) => this.urlTest(tag, signal)),
      );
      const blocked = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected" &&
          [Code.Unauthenticated, Code.PermissionDenied, Code.Unimplemented]
            .includes(ConnectError.from(result.reason).code),
      );
      failure ??= results.find((result) => result.status === "rejected");
      // Stream recovery cancels queued waves but the daemon still owns dispatched probes.
      if (
        native &&
        results.some((result) =>
          result.status === "fulfilled" || canRetry(result.reason),
        )
      )
        await delay(probeWindowMs * windows, cooldown);
      if (blocked) throw blocked.reason;
      return results;
    };
    for (const { tags, windows } of waves) {
      const before = native && !plannedOutbounds ? this.pending.groups : undefined;
      const results = await dispatch(tags, windows);
      if (!before) continue;
      const beforeByTag = new Map(before.map((group) => [group.tag, group]));
      const currentByTag = new Map(
        this.pending.groups?.map((group) => [group.tag, group]),
      );
      const retry = tags.filter(
        (tag, index) =>
          results[index].status === "fulfilled" &&
          hasStaleProbeHistory(tag, beforeByTag, currentByTag),
      );
      // shortcut: retry unchanged existing history once until the API reports per-probe completion.
      if (retry.length) await dispatch(retry, windows);
    }
    signal.throwIfAborted();
    if (failure) throw failure.reason;
  }
  runNetworkQuality = (
    request: NetworkQualityRequest,
    signal: AbortSignal,
    progress: (value: DiagnosticProgress<"networkQuality">) => void,
  ) => this.runDiagnostic("networkQuality", signal, progress, (options) =>
    this.client.startNetworkQualityTest(request, options),
  );
  runSTUN = (
    request: STUNRequest,
    signal: AbortSignal,
    progress: (value: DiagnosticProgress<"stun">) => void,
  ) => this.runDiagnostic("stun", signal, progress, (options) =>
    this.client.startSTUNTest(request, options),
  );
  private async runDiagnostic<K extends DiagnosticName>(
    name: K,
    pageSignal: AbortSignal,
    progress: (value: DiagnosticProgress<K>) => void,
    stream: (options: { signal: AbortSignal; timeoutMs: number }) => AsyncIterable<DiagnosticProgress<K>>,
  ): Promise<DiagnosticProgress<K>> {
    const parent = this.signal;
    if (!parent || parent.aborted || !this.canRunServiceAction() || this.diagnosticScope)
      throw new ConnectError("Diagnostic unavailable", Code.Canceled);
    if (this.pending.capabilities[name].status === "unsupported")
      throw new ConnectError("Diagnostic unsupported", Code.Unimplemented);
    const scope = new AbortController();
    this.diagnosticScope = scope;
    const signal = AbortSignal.any([parent, scope.signal, pageSignal]);
    let final: DiagnosticProgress<K> | undefined;
    try {
      signal.throwIfAborted();
      for await (const message of stream({ signal, timeoutMs: 180_000 })) {
        signal.throwIfAborted();
        this.setCapability(name, { status: "supported" });
        if (final) throw new ConnectError("Unexpected data after final result", Code.DataLoss);
        // In-band errors may contain dial addresses or credentials.
        const safe = {
          ...message,
          error: message.error ? new DiagnosticExecutionError().message : "",
          ...(message.$typeName === "daemon.STUNTestProgress" && {
            externalAddr: this.redactText(message.externalAddr),
          }),
        };
        if (safe.isFinal) final = safe;
        else progress(safe);
      }
      signal.throwIfAborted();
      if (!final) throw new ConnectError("Diagnostic ended before final result", Code.Unavailable);
      if (final.error) throw new DiagnosticExecutionError();
      if (final.phase !== 3) throw new ConnectError("Diagnostic ended before completion", Code.Unavailable);
      this.notify(name === "stun" ? "stunCompleted" : "networkQualityCompleted");
      return final;
    } catch (error) {
      if (!parent.aborted && !pageSignal.aborted) this.notify(name === "stun" ? "stunFailed" : "networkQualityFailed");
      if (signal.aborted) {
        if (scope.signal.reason instanceof ConnectError) throw scope.signal.reason;
        throw new ConnectError("Diagnostic canceled", Code.Canceled);
      }
      const { code } = ConnectError.from(error);
      if (code === Code.Unauthenticated) this.confirmCredentialRejection();
      // A missing selected tag is scoped to the request, not the whole RPC.
      if (!final && code !== Code.NotFound) this.setCapability(name, capabilityFailure(error));
      throw error;
    } finally {
      if (this.diagnosticScope === scope) this.diagnosticScope = undefined;
      scope.abort();
    }
  }
  closeConnection = async (id: string) => {
    if (!this.canRunServiceAction() || !hasCurrentConnections(this.pending))
      throw new ConnectError("Connection list unavailable", Code.Unavailable);
    return this.runUnary((options) => this.client.closeConnection({ id }, options));
  };
  private canCloseConnectionBatch(selection: ConnectionBatchGeneration) {
    return this.topologyGeneration === selection.topologyGeneration &&
      this.pending.connectionGeneration === selection.connectionGeneration &&
      !this.pending.connectionOverflow && !this.pending.authenticationFailed &&
      this.canRunServiceAction() && hasCurrentConnections(this.pending);
  }
  closeConnectionBatch = async (
    { ids, topologyGeneration, connectionGeneration }: ConnectionBatchSelection,
    caller?: AbortSignal,
  ): Promise<ConnectionBatchResult> => {
    const targets = new Set(ids);
    const result = { acknowledged: 0, skipped: 0, unacknowledged: 0, unsent: targets.size };
    const parent = this.signal;
    const canceled = () => ({ ...result, error: "The request was canceled." });
    if (!parent || parent.aborted || caller?.aborted) return canceled();
    const scope = new AbortController();
    const batch = { scope, topologyGeneration, connectionGeneration };
    if (!targets.size || this.connectionBatch || !this.canCloseConnectionBatch(batch))
      return { ...result, error: connectionBatchStale };

    this.connectionBatch = batch;
    const signal = AbortSignal.any(caller ? [parent, scope.signal, caller] : [parent, scope.signal]);
    try {
      for (const id of targets) {
        if (parent.aborted || caller?.aborted) return canceled();
        const connection = this.pending.connections.get(id);
        if (scope.signal.aborted || !this.canCloseConnectionBatch(batch) || !id || !connection)
          return { ...result, error: connectionBatchStale };
        result.unsent--;
        if (connection.closedAt !== 0n) {
          result.skipped++;
          continue;
        }
        result.unacknowledged++;
        await this.runUnary((options) => this.client.closeConnection({ id }, options), signal);
        result.unacknowledged--;
        result.acknowledged++;
      }
      return result;
    } catch (error) {
      if (parent.aborted || caller?.aborted) return canceled();
      if (scope.signal.aborted && ConnectError.from(error).code !== Code.Unauthenticated)
        return { ...result, error: connectionBatchStale };
      return { ...result, error: describeError(error) };
    } finally {
      this.connectionBatch = undefined;
      scope.abort();
    }
  };
  closeAllConnections = async () => {
    const snapshot = this.pending;
    if (!this.canRunServiceAction() || !hasCurrentConnections(snapshot))
      throw new CloseAllUnavailable("stale");
    if (!Array.from(snapshot.connections.values()).some(({ closedAt }) => closedAt === 0n))
      throw new CloseAllUnavailable("empty");
    return this.runUnary((options) => this.client.closeAllConnections({}, options));
  };
}
