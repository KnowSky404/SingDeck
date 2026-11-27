import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Activity, ArrowDownToLine, Copy } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Code, ConnectError } from "@connectrpc/connect";
import { useWorkspace } from "@/app/context";
import {
  accuracyLabels,
  DiagnosticExecutionError,
  filteringLabels,
  mappingLabels,
  networkQualityPhases,
  stunPhases,
  type DiagnosticName,
  type DiagnosticProgress,
} from "@/api/diagnostics";
import { describeError } from "@/api/errors";
import { Choice, Notice, PageHeading, Panel } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ServiceStatus_Type } from "@/proto/daemon/started_service_pb";
import { bitrate, diagnosticMeasurement, validateDiagnosticTarget } from "./model";

type Progress = DiagnosticProgress<DiagnosticName>;
type Result = {
  measuredAt: number;
  outboundTag: string;
  source: "native" | "mock";
  coreVersion?: string;
  apiVersion?: number;
  elapsedMs?: number;
  value: Progress;
};
type Sample = { elapsed: number; download: number; upload: number };
const defaultOutbound = "default";
const diagnosticTitles = { networkQuality: "Network quality", stun: "STUN / NAT" };

export default function Diagnostics() {
  const { t } = useWorkspace();
  const [kind, setKind] = useState<DiagnosticName>("networkQuality");
  const [history, setHistory] = useState<Record<DiagnosticName, Result[]>>({
    networkQuality: [],
    stun: [],
  });
  return (
    <div className="grid gap-4">
      <PageHeading title="Diagnostics" />
      <ToggleGroup
        aria-label={t("Diagnostic tool")}
        type="single"
        variant="outline"
        spacing={0}
        value={kind}
        onValueChange={(value) => {
          if (value === "networkQuality" || value === "stun") setKind(value);
        }}
      >
        <ToggleGroupItem value="networkQuality">{t(diagnosticTitles.networkQuality)}</ToggleGroupItem>
        <ToggleGroupItem value="stun">{t(diagnosticTitles.stun)}</ToggleGroupItem>
      </ToggleGroup>
      <DiagnosticTool
        key={kind}
        kind={kind}
        history={history[kind]}
        onRecord={(result) => setHistory((current) => ({
          ...current,
          [kind]: [result, ...current[kind]].slice(0, 8),
        }))}
        onClear={() => setHistory((current) => ({ ...current, [kind]: [] }))}
      />
    </div>
  );
}

function DiagnosticTool({
  kind,
  history,
  onRecord,
  onClear,
}: {
  kind: DiagnosticName;
  history: Result[];
  onRecord: (report: Result) => void;
  onClear: () => void;
}) {
  const { session, snapshot, profile, t } = useWorkspace();
  const [outbound, setOutbound] = useState(defaultOutbound);
  const [target, setTarget] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [runtime, setRuntime] = useState("20");
  const [serial, setSerial] = useState(false);
  const [http3, setHttp3] = useState(false);
  const [compare, setCompare] = useState(false);
  const [result, setResult] = useState<Result>();
  const [progress, setProgress] = useState<Progress>();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const request = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => {
    request.current?.abort();
    request.current = undefined;
  }, [session]);

  const quality = kind === "networkQuality";
  const capability = snapshot.capabilities[kind];
  const ready = snapshot.phase === "connected" &&
    snapshot.service?.status === ServiceStatus_Type.STARTED &&
    !snapshot.streamErrors.service;
  const inventory = snapshot.streamErrors.outbounds ? undefined : snapshot.outbounds;
  const outboundOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { tag } of inventory ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return (inventory ?? [])
      .filter(({ tag }) => tag && counts.get(tag) === 1)
      .map(({ tag, type }) => ({ value: `tag:${tag}`, label: `${tag} · ${type}` }));
  }, [inventory]);
  const validOutbound = outbound === defaultOutbound || outboundOptions.some(({ value }) => value === outbound);
  const options = [
    { value: defaultOutbound, label: t("Core default outbound") },
    ...outboundOptions,
    ...(!validOutbound ? [{ value: outbound, label: t("Selected outbound unavailable") }] : []),
  ];
  const trimmedTarget = target.trim();

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !validOutbound || request.current || capability.status === "unsupported") return;
    const runtimeSeconds = Number(runtime);
    if (!validateDiagnosticTarget(trimmedTarget, quality)) {
      setError(quality ? "Enter an HTTP(S) configuration URL or a hostname." : "Enter a STUN hostname or IP address and optional port.");
      return;
    }
    if (trimmedTarget && !confirmed) return;
    if (quality && (!Number.isInteger(runtimeSeconds) || runtimeSeconds < 1 || runtimeSeconds > 120)) {
      setError("Enter a test duration from 1 to 120 seconds.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setRunning(true);
    setError("");
    setFeedback("");
    setResult(undefined);
    setProgress(undefined);
    setSamples([]);
    const outboundTag = outbound === defaultOutbound ? "" : outbound.slice(4);
    let elapsedMs: number | undefined;
    const onProgress = (message: Progress) => {
      if (controller.signal.aborted || request.current !== controller) return;
      setProgress(message);
      if (message.$typeName === "daemon.NetworkQualityTestProgress" && message.phase > 0 && message.elapsedMs > 0n) {
        elapsedMs = Number(message.elapsedMs);
        const sample = {
          elapsed: elapsedMs / 1000,
          download: Number(message.downloadCapacity) / 1e6,
          upload: Number(message.uploadCapacity) / 1e6,
        };
        setSamples((current) => [...current, sample].slice(-240));
      }
    };
    try {
      const value = quality
        ? await session.runNetworkQuality({
            configURL: trimmedTarget,
            outboundTag,
            maxRuntimeSeconds: runtimeSeconds,
            serial,
            http3,
          }, controller.signal, onProgress)
        : await session.runSTUN({ server: trimmedTarget, outboundTag }, controller.signal, onProgress);
      if (request.current !== controller || controller.signal.aborted) return;
      const report = {
        value,
        measuredAt: Date.now(),
        outboundTag,
        elapsedMs,
        source: profile.mode,
        coreVersion: snapshot.version?.version,
        apiVersion: snapshot.version?.apiVersion,
      };
      setResult(report);
      if (compare) onRecord(report);
    } catch (cause) {
      if (request.current !== controller) return;
      const canceled = ConnectError.from(cause).code === Code.Canceled;
      setError(canceled
        ? "Diagnostic canceled before completion."
        : cause instanceof DiagnosticExecutionError ? cause.message : describeError(cause));
    } finally {
      if (request.current === controller) {
        request.current = undefined;
        setRunning(false);
      }
    }
  }

  const value = result?.value ?? progress;
  const elapsed = result?.elapsedMs ?? (samples.at(-1)?.elapsed ?? 0) * 1000;
  const phase = value ? t((quality ? networkQualityPhases : stunPhases)[value.phase] ?? "Unknown") : undefined;
  const targetLabel = quality ? "Test configuration URL" : "STUN server";
  const disabled = !ready || capability.status === "unsupported";
  const reportText = result && JSON.stringify({
    tool: kind,
    source: result.source,
    measuredAt: new Date(result.measuredAt).toISOString(),
    outboundTag: result.outboundTag || null,
    coreVersion: result.coreVersion,
    apiVersion: result.apiVersion,
    ...diagnosticMeasurement(result.value, result.elapsedMs),
  }, null, 2);

  return (
    <>
      <Panel
        title={diagnosticTitles[kind]}
        description={quality
          ? "Measure capacity, latency and responsiveness from the sing-box core. Tests can use substantial data."
          : "Check STUN reachability and NAT behavior from the sing-box core."}
      >
        <form onSubmit={(event) => void start(event)} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>{t("Outbound")}</FieldLabel>
              <Choice label="Outbound" value={outbound} options={options}
                onChange={(next) => { setOutbound(next); setConfirmed(false); }} disabled={running || disabled} />
            </Field>
            <Field>
              <FieldLabel htmlFor="diagnostic-target">{t(targetLabel)}</FieldLabel>
              <Input
                id="diagnostic-target"
                value={target}
                onChange={(event) => { setTarget(event.target.value); setConfirmed(false); }}
                placeholder={quality ? "https://mensura.cdn-apple.com/api/v1/gm/config" : "stun.voipgate.com:3478"}
                autoComplete="off"
                spellCheck={false}
                disabled={running || disabled}
              />
            </Field>
            {quality && (
              <>
                <Field>
                  <FieldLabel htmlFor="diagnostic-runtime">{t("Measurement duration (seconds)")}</FieldLabel>
                  <Input id="diagnostic-runtime" type="number" min={1} max={120} required value={runtime}
                    onChange={(event) => setRuntime(event.target.value)} disabled={running || disabled} />
                </Field>
                <div className="grid content-center gap-3">
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="diagnostic-serial">{t("Run download and upload in sequence")}</FieldLabel>
                    <Switch id="diagnostic-serial" checked={serial} onCheckedChange={setSerial} disabled={running || disabled} />
                  </Field>
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="diagnostic-http3">{t("Use HTTP/3 for measurement")}</FieldLabel>
                    <Switch id="diagnostic-http3" checked={http3} onCheckedChange={setHttp3} disabled={running || disabled} />
                  </Field>
                </div>
              </>
            )}
          </div>
          {trimmedTarget && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={confirmed} disabled={running || disabled}
                onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 accent-primary" />
              {t(quality
                ? "I authorize the core to fetch this configuration and contact the destinations it specifies."
                : "I authorize the core to send UDP requests to this STUN server.")}
            </label>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="submit" disabled={disabled || !validOutbound || running || (Boolean(trimmedTarget) && !confirmed)}>
              <Activity />{t("Run test")}
            </Button>
            {running && <Button type="button" variant="outline" onClick={() => request.current?.abort()}>{t("Cancel test")}</Button>}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={compare} disabled={running} className="accent-primary"
                onChange={(event) => setCompare(event.target.checked)} />
              {t("Keep results for this page")}
            </label>
          </div>
          {disabled && <p className="text-sm text-muted-foreground">{t(capability.error ?? "Tests require a running core and an active connection.")}</p>}
          {!disabled && !validOutbound && <p className="text-sm text-muted-foreground">{t("Choose an available outbound to continue.")}</p>}
          {!disabled && !error && capability.error && <p className="text-sm text-muted-foreground">{t(capability.error)}</p>}
        </form>
      </Panel>
      {error && <Notice title="Test incomplete">{t(error)}</Notice>}
      {(running || value) && (
        <Panel
          title={result ? "Test report" : "Test progress"}
          action={<span className="text-sm text-muted-foreground" role="status">
            {t(result ? "Completed" : running ? phase ?? "Starting" : "Incomplete")}
          </span>}
        >
          <div className="grid gap-4">
            {running && quality && (
              <progress className="h-2 w-full accent-primary" aria-label={t("Measurement progress")}
                max={Number(runtime)} value={elapsed > 0 ? Math.min(elapsed / 1000, Number(runtime) * 0.99) : undefined} />
            )}
            {value?.$typeName === "daemon.NetworkQualityTestProgress" && <QualityReadout value={value} elapsed={elapsed} />}
            {value?.$typeName === "daemon.STUNTestProgress" && <STUNReadout value={value} completed={Boolean(result)} />}
            {samples.length > 1 && (
              <div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span>{t("Capacity (Mbit/s)")}</span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-0.5 w-4 bg-[var(--chart-1)]" />
                    {t("Download")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-0.5 w-4 bg-[var(--chart-2)]" />
                    {t("Upload")}
                  </span>
                </div>
                <div className="chart-frame" role="img"
                  aria-label={t("Download and upload capacity over time in Mbit/s")}>
                  <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <LineChart data={samples}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="elapsed" tickFormatter={(seconds: number) => `${seconds.toFixed(1)}s`} minTickGap={25} />
                      <YAxis width={48} />
                      <Tooltip labelFormatter={(seconds) => `${seconds}s`} />
                      <Line type="monotone" dataKey="download" name={t("Download")}
                        stroke="var(--chart-1)" dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="upload" name={t("Upload")}
                        stroke="var(--chart-2)" dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            {reportText && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(reportText);
                    setFeedback("Report copied.");
                  } catch {
                    setFeedback("Clipboard unavailable. Use Export to save the report.");
                  }
                }}><Copy />{t("Copy report")}</Button>
                <Button variant="outline" onClick={() => {
                  const url = URL.createObjectURL(new Blob([reportText], { type: "application/json" }));
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `singdeck-${kind}-${result.measuredAt}.json`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}><ArrowDownToLine />{t("Export report")}</Button>
                {feedback && <span className="text-sm text-muted-foreground" role="status">{t(feedback)}</span>}
              </div>
            )}
          </div>
        </Panel>
      )}
      {history.length > 0 && (
        <Panel title="Test comparison" description="Up to eight reports per tool are kept until you leave this page."
          action={<Button variant="outline" size="sm" onClick={onClear}>{t("Clear results")}</Button>}>
          <div className="grid gap-2">
            {history.map((report, index) => (
              <div key={`${report.measuredAt}-${index}`} className="grid gap-2 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_3fr]">
                <div className="min-w-0 wrap-anywhere">
                  <strong>{report.outboundTag || t("Core default outbound")}</strong>
                  <div className="text-sm text-muted-foreground">{new Date(report.measuredAt).toLocaleString()}</div>
                </div>
                {report.value.$typeName === "daemon.NetworkQualityTestProgress"
                  ? <QualityReadout value={report.value} elapsed={report.elapsedMs} />
                  : <STUNReadout value={report.value} completed />}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

function DiagnosticMetrics({ values }: { values: [name: string, value: string, detail?: string][] }) {
  const { t } = useWorkspace();
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {values.map(([name, value, detail]) => (
        <div key={name} className="min-w-0 wrap-anywhere">
          <dt className="text-sm text-muted-foreground">{t(name)}</dt>
          <dd className="font-medium tabular-nums">{value}</dd>
          {detail && <dd className="text-xs text-muted-foreground">{detail}</dd>}
        </div>
      ))}
    </dl>
  );
}

function QualityReadout({ value, elapsed }: { value: DiagnosticProgress<"networkQuality">; elapsed?: number }) {
  const { t } = useWorkspace();
  const confidence = (accuracy: number) => t("{level} confidence", { level: t(accuracyLabels[accuracy] ?? "Unknown") });
  return <DiagnosticMetrics values={[
    ["Download capacity", bitrate(value.downloadCapacity), value.downloadCapacity > 0n ? confidence(value.downloadCapacityAccuracy) : undefined],
    ["Upload capacity", bitrate(value.uploadCapacity), value.uploadCapacity > 0n ? confidence(value.uploadCapacityAccuracy) : undefined],
    ["Download RPM", value.downloadRPM > 0 ? String(value.downloadRPM) : "—", value.downloadRPM > 0 ? confidence(value.downloadRPMAccuracy) : undefined],
    ["Upload RPM", value.uploadRPM > 0 ? String(value.uploadRPM) : "—", value.uploadRPM > 0 ? confidence(value.uploadRPMAccuracy) : undefined],
    ["Idle latency", value.phase > 0 && value.idleLatencyMs >= 0 ? `${value.idleLatencyMs} ms` : "—"],
    ["Measured elapsed time", elapsed ? `${(elapsed / 1000).toFixed(1)} s` : "—"],
  ]} />;
}

function STUNReadout({ value, completed }: { value: DiagnosticProgress<"stun">; completed: boolean }) {
  const { t } = useWorkspace();
  return <DiagnosticMetrics values={[
    ["STUN reachability", value.externalAddr ? t("Binding response received") : "—"],
    ["External address", value.externalAddr || "—"],
    ["Latency", value.externalAddr && value.latencyMs >= 0 ? `${value.latencyMs} ms` : "—"],
    ["NAT behavior detection", completed
      ? t(!value.natTypeSupported ? "Unavailable on this STUN server"
        : value.natMapping > 1 && value.natFiltering > 0 ? "Mapping and filtering reported" : "NAT behavior results incomplete")
      : "—"],
    ["NAT mapping", value.natMapping ? t(mappingLabels[value.natMapping] ?? "Unknown") : "—"],
    ["NAT filtering", value.natFiltering ? t(filteringLabels[value.natFiltering] ?? "Unknown") : "—"],
  ]} />;
}
