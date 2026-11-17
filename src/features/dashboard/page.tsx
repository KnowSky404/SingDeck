import {
  ArrowDown,
  ArrowUp,
  ArrowRight,
  Network,
  Cpu,
  Activity,
} from "lucide-react";
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
  PageHeading,
  Panel,
  EmptyState,
} from "@/components/shared";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { bytes, time, uptime } from "@/lib/format";
import { ServiceStatus_Type } from "@/proto/daemon/started_service_pb";
import { LogLevel } from "@/proto/daemon/started_service_pb";
import { LogLine } from "@/features/logs/log-line";

export default function Dashboard() {
  const { profile, snapshot, t } = useWorkspace();
  const { status, version, traffic, service } = snapshot;
  const latest = traffic.at(-1);
  const recentLogs = snapshot.logs
    .filter((entry) => entry.level <= LogLevel.INFO)
    .slice(-4);
  const available = status?.trafficAvailable;
  const metrics = [
    {
      label: t("Download"),
      value: available && latest ? `${bytes(latest.down)}/s` : "—",
      icon: ArrowDown,
      kind: "download",
    },
    {
      label: t("Upload"),
      value: available && latest ? `${bytes(latest.up)}/s` : "—",
      icon: ArrowUp,
      kind: "upload",
    },
    {
      label: t("Active connections"),
      value: status
        ? String(available ? status.connectionsIn : status.connectionsOut)
        : "—",
      icon: Network,
      kind: "",
    },
    { label: t("Memory"), value: bytes(status?.memory), icon: Cpu, kind: "" },
  ];
  const serviceName = service
    ? (["Idle", "Starting", "Running", "Stopping", "Fatal"][service.status] ??
      "Unknown")
    : "Unavailable";
  return (
    <>
      <PageHeading title={t("Overview")} />
      <div className="metrics-grid">
        {metrics.map(({ label, value, icon: Icon, kind }) => (
          <Card key={label} className="metric">
            <CardHeader>
              <CardTitle>{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <Icon className={kind} />
              <strong>{value}</strong>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="overview-grid">
        <Panel
          title={t("Traffic activity")}
          action={
            <span className="subtle">
              {t("Last {seconds} seconds", {
                seconds: profile.preferences.windowSeconds,
              })}
            </span>
          }
          className="traffic-panel"
        >
          <ChannelState channel="status">
            {!available ? (
              <EmptyState
                title={t("Traffic unavailable")}
                description={t(
                  "The native API has not reported traffic tracking data.",
                )}
              />
            ) : traffic.length < 2 ? (
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
                  "Traffic history. Current download {down} per second; upload {up} per second.",
                  { down: bytes(latest?.down), up: bytes(latest?.up) },
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
                    <Area
                      dataKey="down"
                      type="monotone"
                      stroke="var(--chart-1)"
                      fill="url(#download-fill)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                    <Area
                      dataKey="up"
                      type="monotone"
                      stroke="var(--chart-2)"
                      fill="url(#upload-fill)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
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
        </Panel>
        <Panel title={t("Instance details")}>
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
          </dl>
          {service?.status === ServiceStatus_Type.FATAL && (
            <p role="alert">
              {t(
                "The service reported a fatal error. Inspect the instance locally.",
              )}
            </p>
          )}
        </Panel>
      </div>
      <div className="overview-bottom">
        <Panel
          title={t("Outbound groups")}
          action={
            <Button variant="link" size="sm" asChild>
              <a href="#/proxies">
                {t("View proxies")}
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
        </Panel>
        <Panel
          title={t("Recent logs")}
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
        </Panel>
      </div>
    </>
  );
}
