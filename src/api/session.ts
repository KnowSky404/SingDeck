import { Code, ConnectError } from "@connectrpc/connect";
import {
  ServiceStatus_Type,
  type Group,
  type GroupItem,
} from "@/proto/daemon/started_service_pb";
import type { SingBoxClient } from "./client";
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

export class InstanceSession {
  private snapshot = initialSnapshot();
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private pending = initialSnapshot();
  private logSequence = { value: 0 };
  private latencyTest?: { controller: AbortController; promise: Promise<void> };
  private manualLatencyTests = 0;
  private latencyCooldown = new AbortController();
  private groupsScope?: AbortController;

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
    if (this.latencyTest && !this.canTestLatencies())
      this.latencyTest.controller.abort();
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
    this.manualLatencyTests = 0;
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
  private async start(signal: AbortSignal) {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const metadata = await this.readMetadata(signal);
        if (signal.aborted) return;
        this.update({ ...metadata, error: undefined });
        await Promise.all(
          (
            ["service", "status", "groups", "logs", "connections"] as Channel[]
          ).map((channel) =>
            channel === "groups"
              ? this.restartGroups(signal)
              : this.stream(channel, signal),
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
  private async restartGroups(parentSignal: AbortSignal) {
    this.groupsScope?.abort();
    const scope = new AbortController();
    this.groupsScope = scope;
    const stop = () => scope.abort();
    parentSignal.addEventListener("abort", stop, { once: true });
    try {
      await this.stream("groups", scope.signal);
    } finally {
      parentSignal.removeEventListener("abort", stop);
      if (this.groupsScope === scope) this.groupsScope = undefined;
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
            const metadata = await this.readMetadata(scope.signal);
            if (parentSignal.aborted) return;
            this.update(metadata);
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
            received();
            if (service.status === ServiceStatus_Type.STARTED) {
              const previous = this.pending.service?.status;
              if (
                previous !== undefined &&
                previous !== ServiceStatus_Type.STARTED
              ) {
                this.update({
                  groups: undefined,
                  loaded: { ...this.pending.loaded, groups: false },
                });
                void this.restartGroups(parentSignal);
              }
              this.update({ service });
            } else {
              this.resetLatencyTests();
              this.update({
                service,
                groups: undefined,
                loaded: { ...this.pending.loaded, groups: false },
                testingLatencies: undefined,
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
            const connections = applyConnections(
              this.pending.connections,
              events,
            );
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
                ? overflow
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
        const retry =
          this.profile.preferences.autoReconnect &&
          canRetry(error) &&
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
  urlTest = (outboundTag: string, signal = this.signal) =>
    this.runUnary(
      (options) => this.client.uRLTest({ outboundTag }, options),
      signal,
    );
  private canTestLatencies() {
    return (
      this.pending.phase === "connected" &&
      this.pending.service?.status === ServiceStatus_Type.STARTED &&
      this.pending.groups !== undefined &&
      !this.pending.streamErrors.service &&
      !this.pending.streamErrors.groups
    );
  }
  testLatency = (tag: string, windows: number) => {
    const signal = this.signal;
    if (!signal || signal.aborted || !this.canTestLatencies() || this.latencyTest)
      return Promise.reject(new ConnectError("Test unavailable", Code.Canceled));
    const cooldown = this.latencyCooldown.signal;
    this.manualLatencyTests++;
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
        if (--this.manualLatencyTests === 0)
          this.update({ testingManualLatency: undefined }, true);
      });
    return request;
  };
  testLatencies = (waves: LatencyTestWave[]) => {
    if (this.latencyTest) return this.latencyTest.promise;
    const sessionSignal = this.signal;
    if (!sessionSignal || sessionSignal.aborted)
      return Promise.reject(new ConnectError("Disconnected", Code.Canceled));
    if (!this.canTestLatencies() || this.manualLatencyTests)
      return Promise.reject(new ConnectError("Service unavailable", Code.Canceled));
    const controller = new AbortController();
    const stop = () => controller.abort(sessionSignal.reason);
    sessionSignal.addEventListener("abort", stop, { once: true });
    const promise = this.runLatencyTests(
      waves,
      controller.signal,
      this.latencyCooldown.signal,
    )
      .then(() => {
        if (
          this.latencyTest?.controller === controller &&
          this.profile.mode === "native"
        )
          this.update({ latencyTestSent: true }, true);
      })
      .catch((error: unknown) => {
        if (this.latencyTest?.controller === controller)
          this.update({ latencyTestError: describeError(error) }, true);
        throw error;
      })
      .finally(() => {
        sessionSignal.removeEventListener("abort", stop);
        if (this.latencyTest?.controller !== controller) return;
        this.latencyTest = undefined;
        this.update({ testingLatencies: undefined }, true);
      });
    this.latencyTest = { controller, promise };
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
    signal: AbortSignal,
    cooldown: AbortSignal,
  ) {
    let failure: PromiseRejectedResult | undefined;
    const native = this.profile.mode === "native";
    const dispatch = async (tags: string[], windows: number) => {
      signal.throwIfAborted();
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
      const before = native ? this.pending.groups : undefined;
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
  closeConnection = (id: string) =>
    this.runUnary((options) => this.client.closeConnection({ id }, options));
  closeAllConnections = () =>
    this.runUnary((options) => this.client.closeAllConnections({}, options));
}
