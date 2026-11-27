import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useWorkspace } from "@/app/context";
import { runtimeStaleIntervals } from "@/api/runtime";
import type { Channel, Snapshot } from "@/api/state";
import { Badge } from "@/components/ui/badge";
import { Choice, EmptyState, Notice, Panel } from "@/components/shared";
import { bytes, uptime } from "@/lib/format";
import { useRuntimeWindow } from "./use-runtime-window";
import { ServiceStatus_Type } from "@/proto/daemon/started_service_pb";

const windows = [
  { value: "60", label: "1 minute" },
  { value: "180", label: "3 minutes" },
  { value: "300", label: "5 minutes" },
];
const streamLabels: Record<Channel, string> = {
  service: "Service lifecycle",
  status: "Runtime status",
  groups: "Groups",
  connections: "Connections",
  logs: "Logs",
  outbounds: "Outbound inventory",
  clashMode: "Clash Mode",
  notifications: "Notifications",
};
const serviceLabels = ["Idle", "Starting", "Running", "Stopping", "Fatal"];
const phaseLabels = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  error: "Connection failed",
};
const count = (value?: number) => value === undefined ? "—" : String(value);
const rate = (value?: number) => value === undefined ? "—" : `${bytes(value)}/s`;

type Sample = Snapshot["runtime"]["samples"][number];
type Event = Snapshot["runtime"]["events"][number];
type SeriesKey = "memory" | "goroutines" | "connectionsIn" | "connectionsOut" | "up" | "down";
type ChartPoint = { time: number } & Partial<Record<SeriesKey, number>>;
type Series = { key: SeriesKey; label: string };

function chartPoints(samples: Sample[]): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (const sample of samples) {
    const previous = points.at(-1);
    if (previous && sample.gapBefore) {
      points.push({ time: (previous.time + sample.time) / 2 });
    }
    points.push({
      ...sample,
      memory: sample.memory > 0n ? Number(sample.memory) : undefined,
    });
  }
  return points;
}

function summarizeRates(samples: Sample[], key: "up" | "down") {
  const measured = samples.flatMap((sample) => {
    const value = sample[key];
    return value === undefined ? [] : [value];
  });
  return measured.length
    ? {
        peak: Math.max(...measured),
        average: measured.reduce((sum, value) => sum + value, 0) / measured.length,
      }
    : undefined;
}

function streamState(snapshot: Snapshot, channel: Channel, statusStale: boolean, streamsAborted: boolean): string {
  if (snapshot.phase === "disconnected") return "Disconnected";
  if (channel === "notifications") {
    const capability = snapshot.capabilities.notifications.status;
    if (streamsAborted || capability === "unsupported" || capability === "unavailable") return "Unavailable";
    if (snapshot.detailChannel !== "notifications") return "Inactive";
    if (snapshot.streamErrors.notifications) return "Interrupted";
    return snapshot.loaded.notifications ? "Event received" : "Awaiting event";
  }
  if (channel === "clashMode") return "Inactive";
  if (snapshot.streamErrors[channel]) return "Interrupted";
  if (channel === "outbounds") return "Inactive";
  if (streamsAborted) return "Unavailable";
  if (channel === "groups" && !snapshot.loaded.groups && snapshot.service &&
    snapshot.service.status !== ServiceStatus_Type.STARTED) return "Inactive";
  if (channel === "status" && statusStale) return "Stale";
  return snapshot.loaded[channel] ? "Live" : "Waiting for data";
}

const eventNames = {
  restart: "Core service restart observed",
  "status-lost": "Runtime stream interrupted",
  "status-resumed": "Runtime stream resumed",
};

export default function RuntimeMonitor() {
  const { snapshot, profile, language, session, t } = useWorkspace();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  const { status, version, service, runtime } = snapshot;
  const streamsAborted = session.signal?.aborted ?? false;
  const [windowSeconds, setWindowSeconds] = useState(String(profile.preferences.windowSeconds));
  const latest = runtime.samples.at(-1);
  const samples = useRuntimeWindow(runtime.samples, Number(windowSeconds));
  const points = useMemo(() => chartPoints(samples), [samples]);
  const averages = useMemo(
    () => ({ down: summarizeRates(samples, "down"), up: summarizeRates(samples, "up") }),
    [samples],
  );
  const timestamp = useMemo(
    () => new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "medium" }),
    [language],
  );
  const chartTime = useMemo(
    () => new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    [language],
  );
  const lastStatus = runtime.lastFrameAt.status;
  const staleAfterMs = profile.preferences.intervalMs * runtimeStaleIntervals;
  const [staleFrame, setStaleFrame] = useState<number>();
  useEffect(() => {
    if (lastStatus === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!document.hidden) {
        timer = setTimeout(
          () => setStaleFrame(lastStatus),
          Math.max(0, lastStatus + staleAfterMs - Date.now()),
        );
      }
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [lastStatus, staleAfterMs]);
  const stale = Boolean(latest && (
    snapshot.phase !== "connected" ||
    snapshot.streamErrors.status ||
    (lastStatus !== undefined && staleFrame === lastStatus) ||
    runtime.events.some((event) => event.kind === "restart" && event.time > latest.time)
  ));
  const metrics = [
    ["Memory", bytes(latest?.memory || undefined)],
    ["Goroutines", count(latest?.goroutines)],
    ["Inbound connections", count(latest?.connectionsIn)],
    ["Outbound connections", count(latest?.connectionsOut)],
    ["Download", rate(latest?.down)],
    ["Upload", rate(latest?.up)],
  ];
  const details = [
    ["Connection status", t(phaseLabels[snapshot.phase])],
    ["Service", t(service ? serviceLabels[service.status] ?? "Unknown" : "Unavailable")],
    ["Core version", version?.version ?? "—"],
    ["API version", version?.apiVersion ?? "—"],
    [
      "Uptime",
      !stale && !snapshot.streamErrors.service && service?.status === ServiceStatus_Type.STARTED
        ? t(uptime(snapshot.startedAt))
        : "—",
    ],
    ["Last received", <RuntimeTime value={runtime.lastFrameAt.status} formatter={timestamp} />],
    ["Cumulative download", status?.trafficAvailable ? bytes(status.downlinkTotal) : "—"],
    ["Cumulative upload", status?.trafficAvailable ? bytes(status.uplinkTotal) : "—"],
  ] as const;
  const eventLabel = (event: Event) => event.kind === "service"
    ? t("Service: {status}", {
        status: t(serviceLabels[event.status] ?? "Unknown"),
      })
    : t(eventNames[event.kind]);

  return (
    <div className="feature-stack">
      <h1 ref={heading} tabIndex={-1} className="w-fit rounded-sm text-xl font-semibold">{t("Runtime monitor")}</h1>
      {stale && (
        <Notice title="Runtime data is stale">
          {snapshot.streamErrors.status
            ? t(snapshot.streamErrors.status)
            : t("Retained data may be stale.")}
        </Notice>
      )}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel title={<h2>{t("Current runtime")}</h2>}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
            {metrics.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-sm text-muted-foreground">{t(label)}</dt>
                <dd className="mt-1 wrap-anywhere text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {!status?.trafficAvailable && (
            <p className="footnote mt-4">{t("The native API has not reported traffic tracking data.")}</p>
          )}
        </Panel>
        <Panel title={<h2>{t("Instance details")}</h2>}>
          <dl className="detail-list">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt>{t(label)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <section aria-labelledby="runtime-history-title" className="feature-stack">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="runtime-history-title" className="font-semibold">{t("Observed runtime history")}</h2>
            <p className="text-sm text-muted-foreground">{t("History covers samples received by this browser.")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{t("History window")}</span>
            <Choice
              label="History window"
              value={windowSeconds}
              onChange={setWindowSeconds}
              options={windows.map(({ value, label }) => ({ value, label: t(label) }))}
            />
          </div>
        </div>
        {samples.slice(1).some(({ gapBefore }) => gapBefore) && (
          <p className="footnote">{t("Chart gaps show interruptions in observed data.")}</p>
        )}
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <RuntimeChart
            title="Traffic rate history"
            points={points}
            series={[{ key: "down", label: "Download" }, { key: "up", label: "Upload" }]}
            format={rate}
            chartTime={chartTime}
          >
            <table className="mt-3 w-full table-fixed text-start text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="text-start font-medium">{t("Direction")}</th>
                  <th scope="col" className="text-end font-medium">{t("Peak")}</th>
                  <th scope="col" className="text-end font-medium">{t("Average")}</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ["Download", averages.down],
                  ["Upload", averages.up],
                ] as const).map(([label, values]) => (
                  <tr key={label}>
                    <th scope="row" className="py-1 text-start font-medium">{t(label)}</th>
                    <td className="text-end tabular-nums">{rate(values?.peak)}</td>
                    <td className="text-end tabular-nums">{rate(values?.average)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </RuntimeChart>
          <RuntimeChart
            title="Connection count history"
            points={points}
            series={[
              { key: "connectionsIn", label: "Inbound connections" },
              { key: "connectionsOut", label: "Outbound connections" },
            ]}
            format={count}
            chartTime={chartTime}
          />
          <RuntimeChart
            title="Memory history"
            points={points}
            series={[{ key: "memory", label: "Memory" }]}
            format={bytes}
            chartTime={chartTime}
          />
          <RuntimeChart
            title="Goroutines history"
            points={points}
            series={[{ key: "goroutines", label: "Goroutines" }]}
            format={count}
            chartTime={chartTime}
          />
        </div>
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel title={<h2>{t("Stream health")}</h2>}>
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th scope="col" className="w-[32%] py-2 text-start font-medium">{t("Stream")}</th>
                <th scope="col" className="w-[29%] py-2 text-start font-medium">{t("State")}</th>
                <th scope="col" className="py-2 text-start font-medium">{t("Last received")}</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(streamLabels) as Channel[]).map((channel) => {
                if (channel === "clashMode" && snapshot.capabilities.clashMode.status !== "supported")
                  return null;
                const state = streamState(snapshot, channel, stale, streamsAborted);
                return (
                  <tr key={channel} className="border-b last:border-b-0">
                    <th scope="row" className="py-2 pe-2 text-start font-medium">
                      {t(streamLabels[channel])}
                    </th>
                    <td className="py-2 pe-1">
                      <Badge variant={state === "Live" ? "default" : "secondary"} className="max-w-full whitespace-normal">
                        {t(state)}
                      </Badge>
                    </td>
                    <td className="wrap-anywhere py-2 text-muted-foreground">
                      <RuntimeTime value={runtime.lastFrameAt[channel]} formatter={timestamp} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
        <Panel title={<h2>{t("Service events")}</h2>}>
          {runtime.events.length ? (
            <ol className="grid gap-2">
              {runtime.events.slice().reverse().map((event, index) => (
                <li key={`${event.time}-${event.kind}-${index}`} className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-b pb-2 text-sm last:border-b-0">
                  <div>
                    {eventLabel(event)}
                    {event.kind === "restart" &&
                      event.startedAt > 0n && event.startedAt <= 8_640_000_000_000_000n && (
                      <div className="text-muted-foreground">
                        {t("Service started at {time}", { time: timestamp.format(Number(event.startedAt)) })}
                      </div>
                    )}
                  </div>
                  <span className="text-muted-foreground">
                    <RuntimeTime value={event.time} formatter={timestamp} />
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="No service events yet" description="Observed lifecycle and connection changes will appear here." />
          )}
        </Panel>
      </div>
    </div>
  );
}

function RuntimeTime({ value, formatter }: { value?: number; formatter: Intl.DateTimeFormat }) {
  if (value === undefined) return "—";
  return <time className="tabular-nums" dateTime={new Date(value).toISOString()}>{formatter.format(value)}</time>;
}

const seriesStyles = [
  { color: "var(--chart-1)", dash: undefined },
  { color: "var(--chart-2)", dash: "5 3" },
];

function SeriesMarker({ seriesIndex, x, y }: { seriesIndex: number; x: number; y: number }) {
  const { color } = seriesStyles[seriesIndex];
  return seriesIndex === 0
    ? <circle cx={x} cy={y} r={2.75} fill={color} />
    : <rect x={x - 4.5} y={y - 4.5} width={9} height={9} fill="none" stroke={color} strokeWidth={1.5} />;
}

function RuntimeChart({
  title,
  points,
  series,
  format,
  chartTime,
  children,
}: {
  title: string;
  points: ChartPoint[];
  series: Series[];
  format: (value: number) => string;
  chartTime: Intl.DateTimeFormat;
  children?: ReactNode;
}) {
  const { t } = useWorkspace();
  const hasData = points.some((point) => series.some(({ key }) => point[key] !== undefined));
  return (
    <Panel title={<h3>{t(title)}</h3>}>
      {hasData ? (
        <>
          <section className="chart-frame" aria-label={t(title)}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart title={t(title)} data={points} margin={{ top: 7, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
                <XAxis
                  type="number"
                  dataKey="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(value: number) => chartTime.format(value)}
                  minTickGap={26}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <YAxis
                  tickFormatter={format}
                  width={68}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <Tooltip
                  labelFormatter={(value) => chartTime.format(Number(value))}
                  formatter={(value) => format(Number(value))}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--foreground)",
                  }}
                />
                {series.map(({ key, label }, seriesIndex) => {
                  const { color, dash } = seriesStyles[seriesIndex];
                  return (
                    <Line
                      key={key}
                      type="linear"
                      name={t(label)}
                      dataKey={key}
                      stroke={color}
                      strokeWidth={2}
                      strokeDasharray={dash}
                      dot={({ index, cx, cy }) => {
                        const isolated = points[index]?.[key] !== undefined &&
                          points[index - 1]?.[key] === undefined && points[index + 1]?.[key] === undefined;
                        if (!isolated || cx === undefined || cy === undefined) return null;
                        return <SeriesMarker seriesIndex={seriesIndex} x={cx} y={cy} />;
                      }}
                      activeDot={({ cx, cy }) => cx === undefined || cy === undefined
                        ? null
                        : <SeriesMarker seriesIndex={seriesIndex} x={cx} y={cy} />}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </section>
          {series.length > 1 && (
            <div className="chart-legend flex-wrap">
              {series.map(({ key, label }, index) => (
                <span key={key}>
                  <svg width="32" height="12" aria-hidden="true" focusable="false">
                    <SeriesMarker seriesIndex={index} x={6} y={6} />
                    <line
                      x1="15"
                      x2="32"
                      y1="6"
                      y2="6"
                      stroke={seriesStyles[index].color}
                      strokeWidth={2}
                      strokeDasharray={seriesStyles[index].dash}
                    />
                  </svg>
                  {t(label)}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <EmptyState title="No samples in this window" description="The core has not reported these measurements in this window." />
      )}
      {children}
    </Panel>
  );
}
