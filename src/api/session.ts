import { Code, ConnectError } from "@connectrpc/connect";
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

export class InstanceSession {
  private snapshot = initialSnapshot();
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private pending = initialSnapshot();
  private logSequence = { value: 0 };

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
    void this.start(scope.signal);
  };
  disconnect = () => {
    this.controller?.abort();
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.pending = initialSnapshot();
    this.update({}, true);
  };
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
          ).map((channel) => this.stream(channel, signal)),
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
            this.update({ service });
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
  urlTest = (outboundTag: string) =>
    this.runUnary((options) => this.client.uRLTest({ outboundTag }, options));
  closeConnection = (id: string) =>
    this.runUnary((options) => this.client.closeConnection({ id }, options));
  closeAllConnections = () =>
    this.runUnary((options) => this.client.closeAllConnections({}, options));
}
