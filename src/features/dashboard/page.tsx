import {
  ArrowDown,
  ArrowUp,
  ArrowRight,
  Network,
  Cpu,
  Activity,
} from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { useWorkspace } from "@/app/context";
import {
  ChannelState,
  Choice,
  PageHeading,
  Panel,
  EmptyState,
  Notice,
} from "@/components/shared";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { bytes, time, uptime } from "@/lib/format";
import { ServiceStatus_Type } from "@/proto/daemon/started_service_pb";
import { LogLevel } from "@/proto/daemon/started_service_pb";
import { LogLine } from "@/features/logs/log-line";
import { runtimeWindows, useRuntimeWindow } from "./use-runtime-window";
import { useRuntimeStale } from "./use-runtime-stale";
import { OverviewCustomization } from "./overview-customization";
import {
  loadOverviewLayout,
  overviewMetricLabels,
  overviewPanelLabels,
  saveOverviewLayout,
  type OverviewLayout,
  type OverviewPanel,
} from "./overview-layout";

function OverviewPanels({ order, ...panels }: Record<OverviewPanel, ReactNode> & {
  order: OverviewLayout["panels"];
}) {
  return (
    <div className="overview-grid">
      {order.map((card) => <Fragment key={card}>{panels[card]}</Fragment>)}
    </div>
  );
}

export default function Dashboard() {
  const { profile, snapshot, t } = useWorkspace();
  const [layout, setLayout] = useState(loadOverviewLayout);
  function changeLayout(next: OverviewLayout) {
    setLayout(next);
    saveOverviewLayout(next);
  }
  const { status, version, runtime, service } = snapshot;
  const latest = runtime.samples.at(-1);
  const stale = useRuntimeStale(snapshot, profile.preferences.intervalMs);
  const { samples: traffic, windowSeconds, selectWindow } = useRuntimeWindow(runtime.samples, profile.preferences.windowSeconds);
  const measuredTraffic = traffic.filter(({ down }) => down !== undefined);
  const chartRates = stale ? measuredTraffic.at(-1) : latest;
  const recentLogs = snapshot.logs
    .filter((entry) => entry.level <= LogLevel.INFO)
    .slice(-4);
  const available = status?.trafficAvailable;
  const metrics = {
    download: {
      value: available && latest?.down !== undefined ? `${bytes(latest.down)}/s` : "—",
      icon: ArrowDown,
      kind: "download",
    },
    upload: {
      value: available && latest?.up !== undefined ? `${bytes(latest.up)}/s` : "—",
      icon: ArrowUp,
      kind: "upload",
    },
    connections: {
      value: (available ? latest?.connectionsIn : latest?.connectionsOut)?.toString() ?? "—",
      icon: Network,
      kind: "",
    },
    memory: { value: bytes(status?.memory || undefined), icon: Cpu, kind: "" },
  };
  const serviceName = service
    ? (["Idle", "Starting", "Running", "Stopping", "Fatal"][service.status] ??
      "Unknown")
    : "Unavailable";
  return (
    <>
      <PageHeading title={t("Overview")} />
      <div className="flex justify-end">
        <OverviewCustomization layout={layout} onChange={changeLayout} />
      </div>
      {stale && !snapshot.streamErrors.status && (
        <Notice title="Runtime data is stale">
          Retained data may be stale.
        </Notice>
      )}
      <div className="metrics-grid">
        {layout.metrics.map((card) => {
          const { value, icon: Icon, kind } = metrics[card];
          return (
            <Card key={card} className="metric">
              <CardHeader>
                <CardTitle>{t(overviewMetricLabels[card])}</CardTitle>
              </CardHeader>
              <CardContent>
                <Icon className={kind} />
                <strong>{value}</strong>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <OverviewPanels
        order={layout.panels}
        traffic={<Panel
          title={overviewPanelLabels.traffic}
          action={
            <Choice
              label="History window"
              value={windowSeconds}
              onChange={selectWindow}
              options={runtimeWindows.map(({ value, label }) => ({ value, label: t(label) }))}
            />
          }
          className="traffic-panel"
        >
          <ChannelState channel="status">
            {measuredTraffic.length === 0 && !available ? (
              <EmptyState
                title={t("Traffic unavailable")}
                description={t(
                  "The native API has not reported traffic tracking data.",
                )}
              />
            ) : measuredTraffic.length === 0 ? (
              <EmptyState
                title={t("Collecting traffic samples")}
                description={t(
                  "The graph appears after the next measured interval.",
                )}
              />
            ) : (
              <div
                className="chart-frame"
                role="img"
                aria-label={t(
                  stale
                    ? "Traffic history. Last observed download {down} per second; upload {up} per second. Readings are stale."
                    : "Traffic history. Current download {down} per second; upload {up} per second.",
                  { down: bytes(chartRates?.down), up: bytes(chartRates?.up) },
                )}
              >
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <AreaChart
                    data={traffic}
                    margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="download-fill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="var(--chart-1)"
                          stopOpacity={0.25}
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--chart-1)"
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                      <linearGradient
                        id="upload-fill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="var(--chart-2)"
                          stopOpacity={0.16}
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--chart-2)"
                          stopOpacity={0.01}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="var(--border)"
                      strokeDasharray="3 4"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="time"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={time}
                      minTickGap={75}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={(value) => `${bytes(Number(value))}/s`}
                      width={70}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    />
                    <Tooltip
                      labelFormatter={(value) => time(Number(value))}
                      formatter={(value, name) => [
                        `${bytes(Number(value))}/s`,
                        t(name === "down" ? "Download" : "Upload"),
                      ]}
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--foreground)",
                      }}
                    />
                    {([
                      ["down", "var(--chart-1)", "url(#download-fill)"],
                      ["up", "var(--chart-2)", "url(#upload-fill)"],
                    ] as const).map(([key, stroke, fill]) => (
                      <Area
                        key={key}
                        dataKey={key}
                        type="monotone"
                        stroke={stroke}
                        fill={fill}
                        strokeWidth={2}
                        dot={({ index, cx, cy }) => {
                          const isolated = traffic[index]?.[key] !== undefined &&
                            traffic[index - 1]?.[key] === undefined &&
                            traffic[index + 1]?.[key] === undefined;
                          return isolated ? <circle cx={cx} cy={cy} r={3} fill={stroke} /> : null;
                        }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            {!available && measuredTraffic.length > 0 && (
              <p className="footnote">{t("The native API has not reported traffic tracking data.")}</p>
            )}
            <div className="chart-legend">
              <span>
                <i className="legend-dot download-dot" />
                {t("Download")}
              </span>
              <span>
                <i className="legend-dot upload-dot" />
                {t("Upload")}
              </span>
            </div>
          </ChannelState>
        </Panel>}
        instance={<Panel title={overviewPanelLabels.instance}>
          <dl className="detail-list">
            <div>
              <dt>{t("Instance")}</dt>
              <dd>
                {profile.mode === "mock"
                  ? t("Demo workspace")
                  : profile.endpoint}
              </dd>
            </div>
            <div>
              <dt>{t("Core version")}</dt>
              <dd>{version?.version ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("API version")}</dt>
              <dd>{version?.apiVersion ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("Uptime")}</dt>
              <dd>{t(uptime(snapshot.startedAt))}</dd>
            </div>
            <div>
              <dt>{t("Service")}</dt>
              <dd>
                <Badge
                  variant={
                    service?.status === ServiceStatus_Type.STARTED
                      ? "default"
                      : "secondary"
                  }
                >
                  {t(serviceName)}
                </Badge>
              </dd>
            </div>
            <div className="detail-break">
              <dt>{t("Cumulative download")}</dt>
              <dd>{available ? bytes(status?.downlinkTotal) : "—"}</dd>
            </div>
            <div>
              <dt>{t("Cumulative upload")}</dt>
              <dd>{available ? bytes(status?.uplinkTotal) : "—"}</dd>
            </div>
            <div>
              <dt>{t("Deprecation warnings")}</dt>
              <dd>{snapshot.warnings?.length ?? "—"}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-x-3">
            <Button className="px-0" variant="link" size="sm" asChild>
              <a href="#/runtime-monitor">
                {t("View runtime monitor")}
                <ArrowRight data-icon="inline-end" />
              </a>
            </Button>
            <Button className="px-0" variant="link" size="sm" asChild>
              <a href="#/configuration-health">
                {t("View configuration health")}
                <ArrowRight data-icon="inline-end" />
              </a>
            </Button>
          </div>
          {service?.status === ServiceStatus_Type.FATAL && (
            <p role="alert">
              {t(
                "The service reported a fatal error. Inspect the instance locally.",
              )}
            </p>
          )}
        </Panel>}
        outbounds={<Panel
          title={overviewPanelLabels.outbounds}
          action={
            <Button variant="link" size="sm" asChild>
              <a href="#/proxies">
                {t("View outbounds")}
                <ArrowRight data-icon="inline-end" />
              </a>
            </Button>
          }
        >
          <ChannelState channel="groups" empty={snapshot.groups?.length === 0}>
            <div className="group-summary">
              {snapshot.groups?.slice(0, 4).map((group) => (
                <a key={group.tag} href="#/proxies">
                  <span>
                    <Activity />
                    <strong>{group.tag}</strong>
                    <Badge variant="secondary">{group.type}</Badge>
                  </span>
                  <span>
                    {group.selected}
                    <ArrowRight />
                  </span>
                </a>
              ))}
            </div>
          </ChannelState>
        </Panel>}
        logs={<Panel
          title={overviewPanelLabels.logs}
          action={
            <Button variant="link" size="sm" asChild>
              <a href="#/logs">
                {t("View logs")}
                <ArrowRight data-icon="inline-end" />
              </a>
            </Button>
          }
        >
          <ChannelState channel="logs" empty={recentLogs.length === 0}>
            <div className="recent-logs">
              {recentLogs.map((log) => (
                <LogLine
                  receiptLabel={t("Local receipt time")}
                  key={log.id}
                  entry={log}
                />
              ))}
            </div>
          </ChannelState>
        </Panel>}
      />
    </>
  );
}
