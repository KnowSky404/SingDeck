import { Code, ConnectError } from "@connectrpc/connect";
import {
  ServiceStatus_Type,
  type Version,
  type Group,
  type GroupItem,
} from "@/proto/daemon/started_service_pb";
import type { SingBoxClient } from "./client";
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
import { canRetry, delay, describeError } from "./errors";
import {
  appendLogs,
  applyConnections,
  assertCompatible,
  CompatibilityError,
  CONNECTION_LIMIT,
  initialSnapshot,
  type Channel,
  type Snapshot,
} from "./state";
import type { Profile } from "@/features/instances/profiles";

const probeWindowMs = 15_250;
type LatencyTestWave = {
  tags: string[];
  windows: number;
};

function probeMayHaveStarted(error: unknown) {
  const { code } = ConnectError.from(error);
  return (
    canRetry(error) ||
    code === Code.Canceled ||
    code === Code.Unknown ||
    code === Code.Internal
  );
}

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

const streamCapabilities: Partial<Record<Channel, CapabilityName>> = {
  outbounds: "outboundInventory",
  groups: "groupManagement",
  status: "runtimeMonitoring",
};

function sameInventory(before: GroupItem[], after: GroupItem[]) {
  if (before === after) return true;
  if (before.length !== after.length) return false;
  const types = new Map(after.map(({ tag, type }) => [tag, type]));
  return before.every(({ tag, type }) => types.get(tag) === type);
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
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private pending = initialSnapshot();
  private logSequence = { value: 0 };
  private latencyTest?: {
    controller: AbortController;
    promise: Promise<void>;
    source: "groups" | "outbounds";
  };
  private manualLatencyTests = new Set<string>();
  private latencyCooldown = new AbortController();
  private serviceReadsScope?: AbortController;
  private detailScope?: AbortController;
  private inventoryEnabled = false;
  private retainClosedOnResume = false;
  private streamsStarted = false;
  private revalidation?: Promise<void>;
  private warningsScope?: AbortController;
  private diagnosticScope?: AbortController;

  constructor(
    readonly client: SingBoxClient,
    readonly profile: Profile,
    private readonly secret = "",
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<Snapshot>, immediate = false) {
    this.pending = { ...this.pending, ...patch };
    if (this.latencyTest && !this.canTestLatencies(this.latencyTest.source))
      this.latencyTest.controller.abort();
    if (!this.canRunServiceAction()) this.interruptDiagnostic();
    if (immediate) this.flush();
    else this.flushTimer ??= setTimeout(() => this.flush(), 100);
  }
  private flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.snapshot = this.pending;
    this.listeners.forEach((listener) => listener());
  }
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
    this.streamsStarted = false;
    this.retainClosedOnResume = false;
    this.revalidation = undefined;
    this.detailScope = undefined;
    this.warningsScope = undefined;
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
    this.manualLatencyTests.clear();
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
      !this.pending.streamErrors.service
    );
  }
  private interruptDiagnostic() {
    this.diagnosticScope?.abort(new ConnectError("Service interrupted", Code.Unavailable));
  }
  private invalidateServiceReads() {
    this.serviceReadsScope?.abort();
    this.serviceReadsScope = undefined;
    this.warningsScope = undefined;
    this.interruptDiagnostic();
    this.retainClosedOnResume = false;
    this.update({
      connections: new Map(),
      connectionOverflow: false,
      groups: undefined,
      outbounds: undefined,
      warnings: undefined,
      checkingWarnings: undefined,
      capabilities: initialCapabilities(),
      loaded: { ...this.pending.loaded, connections: false, groups: false, outbounds: false },
      streamErrors: {
        ...this.pending.streamErrors,
        groups: undefined,
        outbounds: undefined,
      },
    });
    if (!this.inventoryEnabled) this.startDetailStream();
  }
  private async refreshServiceReads(parent: AbortSignal) {
    const scope = new AbortController();
    this.serviceReadsScope = scope;
    const signal = AbortSignal.any([parent, scope.signal]);
    if (this.inventoryEnabled) this.startDetailStream();
    this.readServiceConfiguration();
    await this.stream("groups", signal);
  }
  setInventoryEnabled = (enabled: boolean) => {
    if (enabled === this.inventoryEnabled) return;
    this.inventoryEnabled = enabled;
    if (enabled && this.pending.loaded.connections) this.retainClosedOnResume = true;
    this.detailScope?.abort();
    this.update({
      outbounds: undefined,
      loaded: { ...this.pending.loaded, connections: false, outbounds: false },
      streamErrors: {
        ...this.pending.streamErrors,
        connections: undefined,
        outbounds: undefined,
      },
    });
    this.startDetailStream();
  };
  private startDetailStream() {
    const parent = this.signal;
    if (!parent || parent.aborted || !this.streamsStarted) return;
    const channel = this.inventoryEnabled ? "outbounds" : "connections";
    const service = this.inventoryEnabled ? this.serviceReadsScope?.signal : parent;
    if (!service || service.aborted) return;
    // Keep a request slot free on native HTTP/1.1 origins with a six-socket limit.
    this.detailScope?.abort();
    const scope = new AbortController();
    this.detailScope = scope;
    void this.stream(channel, AbortSignal.any([parent, service, scope.signal]));
  }
  redactText(value: string) {
    return this.secret ? value.replaceAll(this.secret, "[redacted]") : value;
  }
  private readServiceConfiguration() {
    const parent = this.signal;
    const service = this.serviceReadsScope?.signal;
    if (!parent || !service || this.pending.service?.status !== ServiceStatus_Type.STARTED)
      return;
    void this.refreshWarnings();
    void this.probeClashMode(AbortSignal.any([parent, service]));
  }
  refreshWarnings = async () => {
    if (this.pending.service?.status !== ServiceStatus_Type.STARTED) return;
    const parent = this.signal;
    const service = this.serviceReadsScope?.signal;
    if (!parent || parent.aborted || !service || service.aborted || this.warningsScope) return;
    const scope = new AbortController();
    this.warningsScope = scope;
    const signal = AbortSignal.any([parent, service, scope.signal]);
    this.update({ checkingWarnings: true });
    try {
      const data = await this.runUnary(
        (options) => this.client.getDeprecatedWarnings({}, options),
        signal,
      );
      if (signal.aborted) return;
      const redact = (value: string) => this.redactText(value);
      const key = (warning: { message: string; deprecatedVersion: string }) =>
        JSON.stringify([warning.message, warning.deprecatedVersion]);
      // Daemon mode drains its warning collector on read; retain reports for this core lifecycle.
      const warnings = new Map(this.pending.warnings?.map((warning) => [key(warning), warning]));
      for (const warning of data.warnings) {
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
        warnings.set(key(redacted), redacted);
      }
      this.update({ warnings: [...warnings.values()] });
      this.setCapability("deprecatedWarnings", { status: "supported" });
    } catch (error) {
      if (!signal.aborted)
        this.setCapability("deprecatedWarnings", capabilityFailure(error));
    } finally {
      if (this.warningsScope === scope) {
        this.warningsScope = undefined;
        if (!signal.aborted) this.update({ checkingWarnings: false }, true);
      }
    }
  };
  private async probeClashMode(signal: AbortSignal) {
    try {
      await this.runUnary((options) => this.client.getClashModeStatus({}, options), signal);
      if (!signal.aborted)
        this.setCapability("clashMode", { status: "supported" });
    } catch (error) {
      if (!signal.aborted) this.setCapability("clashMode", capabilityFailure(error));
    }
  }
  private coreChanged(metadata: { version: Version; startedAt?: bigint }) {
    const { version, startedAt } = this.pending;
    return (
      version?.version !== metadata.version.version ||
      version?.apiVersion !== metadata.version.apiVersion ||
      (startedAt !== undefined &&
        metadata.startedAt !== undefined &&
        startedAt !== metadata.startedAt)
    );
  }
  clearLogs = () => this.update({ logs: [] }, true);
  private async readMetadata(signal: AbortSignal) {
    const version = await this.client.getVersion({}, { signal });
    signal.throwIfAborted();
    assertCompatible(version);
    const [started, level] = await Promise.allSettled([
      this.runUnary((options) => this.client.getStartedAt({}, options), signal),
      this.runUnary(
        (options) => this.client.getDefaultLogLevel({}, options),
        signal,
      ),
    ]);
    return {
      version,
      startedAt:
        started.status === "fulfilled" ? started.value.startedAt : undefined,
      defaultLogLevel:
        level.status === "fulfilled" ? level.value.level : undefined,
    };
  }
  private revalidateMetadata(signal: AbortSignal) {
    if (this.revalidation) return this.revalidation;
    const revalidation = this.readMetadata(signal)
      .then((metadata) => {
        if (signal.aborted) return;
        const changed = this.coreChanged(metadata);
        this.update(metadata);
        if (changed) this.invalidateServiceReads();
      })
      .finally(() => {
        if (this.revalidation === revalidation) this.revalidation = undefined;
      });
    this.revalidation = revalidation;
    return revalidation;
  }
  private async recoverServiceReads(signal: AbortSignal) {
    try {
      await this.revalidateMetadata(signal);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof CompatibilityError) {
        this.update({ phase: "error", error: error.message }, true);
        this.controller?.abort();
        return;
      }
    }
    if (
      !signal.aborted &&
      !this.serviceReadsScope &&
      this.pending.service?.status === ServiceStatus_Type.STARTED
    )
      void this.refreshServiceReads(signal);
  }
  private async start(signal: AbortSignal) {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const metadata = await this.readMetadata(signal);
        if (signal.aborted) return;
        this.update({ ...metadata, error: undefined });
        this.streamsStarted = true;
        void this.refreshServiceReads(signal);
        if (!this.inventoryEnabled) this.startDetailStream();
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
              authenticationFailed:
                ConnectError.from(error).code === Code.Unauthenticated,
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
          attempt = 0;
          const capability = streamCapabilities[channel];
          if (capability) this.setCapability(capability, { status: "supported" });
          this.update({
            loaded: { ...this.pending.loaded, [channel]: true },
            streamErrors: {
              ...this.pending.streamErrors,
              [channel]: undefined,
            },
          });
        };
        if (channel === "status") {
          if (attempt > 0) {
            await this.revalidateMetadata(parentSignal);
            if (parentSignal.aborted) return;
            if (!this.serviceReadsScope && this.pending.service?.status === ServiceStatus_Type.STARTED)
              void this.refreshServiceReads(parentSignal);
          }
          refreshWatchdog();
          let first = true;
          for await (const status of this.client.subscribeStatus(
            request,
            options,
          )) {
            if (parentSignal.aborted) return;
            refreshWatchdog();
            received();
            this.setCapability("trafficTracking", {
              status: status.trafficAvailable ? "supported" : "unavailable",
            });
            const now = Date.now();
            const seconds = this.profile.preferences.intervalMs / 1000;
            const traffic =
              status.trafficAvailable && !first
                ? [
                    ...this.pending.traffic,
                    {
                      time: now,
                      up: Number(status.uplink) / seconds,
                      down: Number(status.downlink) / seconds,
                    },
                  ]
                    .filter(
                      (p) =>
                        p.time >=
                        now - this.profile.preferences.windowSeconds * 1000,
                    )
                    .slice(-300)
                : [];
            first = false;
            this.update({
              phase: "connected",
              error: undefined,
              status,
              traffic,
            });
          }
        } else if (channel === "service") {
          for await (const service of this.client.subscribeServiceStatus(
            {},
            options,
          )) {
            if (parentSignal.aborted) return;
            const recovering = Boolean(this.pending.streamErrors.service);
            received();
            if (service.status === ServiceStatus_Type.STARTED) {
              const previous = this.pending.service?.status;
              this.update({ service });
              if (recovering || (previous !== undefined && previous !== ServiceStatus_Type.STARTED))
                void this.recoverServiceReads(parentSignal);
              else if (previous === undefined) this.readServiceConfiguration();
            } else {
              if (this.pending.service?.status !== service.status)
                this.invalidateServiceReads();
              this.resetLatencyTests();
              this.update({
                service,
                testingLatencies: undefined,
                stoppingLatencyTests: undefined,
                testingManualLatency: undefined,
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
        if (channel === "status") this.setCapability("trafficTracking", capabilityFailure(error));
        const retry =
          this.profile.preferences.autoReconnect &&
          (canRetry(error) || ConnectError.from(error).code === Code.Canceled) &&
          !(error instanceof CompatibilityError);
        this.update(
          {
            streamErrors: { ...this.pending.streamErrors, [channel]: message },
            authenticationFailed:
              this.pending.authenticationFailed ||
              ConnectError.from(error).code === Code.Unauthenticated,
            ...(channel === "status"
              ? { phase: retry ? "reconnecting" : "error", error: message }
              : {}),
          },
          true,
        );
        if (error instanceof CompatibilityError) this.controller?.abort();
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
    try {
      return await request({ signal });
    } catch (error) {
      if (
        signal &&
        !signal.aborted &&
        ConnectError.from(error).code === Code.Unauthenticated
      )
        this.update({ authenticationFailed: true }, true);
      throw error;
    }
  }
  selectOutbound = async (groupTag: string, outboundTag: string) => {
    const signal = this.signal;
    if (!signal || signal.aborted)
      throw new ConnectError("Disconnected", Code.Canceled);
    await this.runUnary((options) =>
      this.client.selectOutbound({ groupTag, outboundTag }, options),
    );
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        unsubscribe();
        signal.removeEventListener("abort", aborted);
      };
      const aborted = () => {
        cleanup();
        reject(new ConnectError("Canceled", Code.Canceled));
      };
      const check = () => {
        if (
          this.snapshot.groups?.some(
            (g) => g.tag === groupTag && g.selected === outboundTag,
          )
        ) {
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
  };
  urlTest = async (outboundTag: string, signal = this.signal) => {
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
  testLatency = (tag: string, windows: number, source: "groups" | "outbounds" = "groups") => {
    const signal = this.signal;
    if (!signal || signal.aborted || !this.canTestLatencies(source) ||
        this.latencyTest || this.manualLatencyTests.has(tag))
      return Promise.reject(new ConnectError("Test unavailable", Code.Canceled));
    const cooldown = this.latencyCooldown.signal;
    this.manualLatencyTests.add(tag);
    this.update({ testingManualLatency: true }, true);
    const request = this.urlTest(tag, cooldown);
    void request
      .then(() => true, probeMayHaveStarted)
      .then(async (started) => {
        if (started && this.profile.mode === "native")
          await delay(probeWindowMs * windows, cooldown);
      })
      .catch(() => undefined)
      .finally(() => {
        if (cooldown.aborted) return;
        this.manualLatencyTests.delete(tag);
        if (this.manualLatencyTests.size === 0)
          this.update({ testingManualLatency: undefined }, true);
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
    if (!this.canTestLatencies(source) || this.manualLatencyTests.size)
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
        this.update({ testingLatencies: undefined, stoppingLatencyTests: undefined }, true);
      });
    this.latencyTest = { controller, promise, source };
    this.update(
      {
        testingLatencies: true,
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
          result.status === "fulfilled" || probeMayHaveStarted(result.reason),
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
      return final;
    } catch (error) {
      if (signal.aborted) {
        if (scope.signal.reason instanceof ConnectError) throw scope.signal.reason;
        throw new ConnectError("Diagnostic canceled", Code.Canceled);
      }
      const { code } = ConnectError.from(error);
      if (code === Code.Unauthenticated) this.update({ authenticationFailed: true }, true);
      // A missing selected tag is scoped to the request, not the whole RPC.
      if (!final && code !== Code.NotFound) this.setCapability(name, capabilityFailure(error));
      throw error;
    } finally {
      if (this.diagnosticScope === scope) this.diagnosticScope = undefined;
      scope.abort();
    }
  }
  closeConnection = (id: string) =>
    this.runUnary((options) => this.client.closeConnection({ id }, options));
  closeAllConnections = () =>
    this.runUnary((options) => this.client.closeAllConnections({}, options));
}
