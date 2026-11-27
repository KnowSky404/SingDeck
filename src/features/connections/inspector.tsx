import { useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Copy } from "lucide-react";
import { useWorkspace } from "@/app/context";
import { hasCurrentConnections } from "@/api/state";
import { safeNativeText } from "@/api/notifications";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { bytes } from "@/lib/format";
import type { Connection } from "@/proto/daemon/started_service_pb";
import { redactNativeConnectionText } from "./redaction";
import { hasConnectionIntervalDelta } from "./traffic";

function recordedTime(timestamp: bigint, formatter: Intl.DateTimeFormat) {
  const date = new Date(Number(timestamp));
  if (timestamp <= 0n || !Number.isFinite(date.getTime())) return null;
  return <time dateTime={date.toISOString()}>{formatter.format(date)}</time>;
}

function recordedBytes(value: bigint) {
  if (value < 0n) return null;
  const readable = bytes(value);
  return value < 1000n ? readable : `${readable} (${value} B)`;
}

export function ConnectionInspector({
  connectionId,
  onInspectOutbound,
  onClose,
  onCloseAutoFocus,
}: {
  connectionId: string | null;
  onInspectOutbound: (tag: string, topologyGeneration: number) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { snapshot, session, t } = useWorkspace();
  const title = useRef<HTMLHeadingElement>(null);
  const record = connectionId === null ? undefined : snapshot.connections.get(connectionId);
  const current = snapshot.serviceActionsReady && hasCurrentConnections(snapshot);
  const tag = record?.outbound;
  // A credential can equal the fixed redaction marker, even after decoding a label.
  const redactTag = (value: string) => value.includes("[redacted]") ? "" : session.redactText(value);
  const canInspectOutbound = current && !snapshot.authenticationFailed && record?.closedAt === 0n &&
    !!tag && tag.length <= 160 && redactNativeConnectionText(tag, redactTag) === tag &&
    safeNativeText(tag, redactTag, 160) === tag;
  function inspectOutbound() {
    if (canInspectOutbound && session.canInspectReportedOutbound(record.id, tag, snapshot))
      onInspectOutbound(tag, snapshot.topologyGeneration);
  }
  return (
    <Dialog
      open={connectionId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        closeLabel={t("Close")}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          title.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl"
      >
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle ref={title} tabIndex={-1} className="w-fit rounded-sm">{t("Connection details")}</DialogTitle>
          <DialogDescription className="flex min-w-0 gap-2 wrap-anywhere">
            {record ? (
              <>
                <span className="min-w-0 truncate">
                  {redactNativeConnectionText(
                    record.domain || record.destination,
                    (value) => session.redactText(value),
                  ) || t("Unavailable")}
                </span>{" "}
                <span className="shrink-0">{t(record.closedAt > 0n ? "Closed" : "Active")}</span>
              </>
            ) : t(current ? "This connection is no longer in the current records." : "Waiting for the instance…")}
          </DialogDescription>
        </DialogHeader>
        {record && (
          <ConnectionDetails
            key={record.id}
            record={record}
            current={current}
            onInspectOutbound={canInspectOutbound ? inspectOutbound : undefined}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConnectionDetails({ record, current, onInspectOutbound }: {
  record: Connection;
  current: boolean;
  onInspectOutbound?: () => void;
}) {
  const { language, session, t } = useWorkspace();
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false,
  }), [language]);
  const [feedback, setFeedback] = useState("");
  const safe = (value: string | undefined) =>
    value ? redactNativeConnectionText(value, (text) => session.redactText(text)) : null;
  const inbound = safe(record.inbound);
  const source = safe(record.source);
  const destination = safe(record.destination);
  const domain = safe(record.domain);
  const rule = safe(record.rule);
  // The core encodes the resolved leaf first.
  const chain = safe([...record.chainList].reverse().filter(Boolean).join(" → "));
  const process = record.processInfo;
  const processId = process && process.processId > 0 ? String(process.processId) : null;
  const processPath = safe(process?.processPath);
  const packages = safe(process?.packageNames.filter(Boolean).join(", "));
  const processUserName = safe(process?.userName);
  // The core uses -1 for an unavailable UID and 0 is a valid UID.
  const processUserId = process && process.userId >= 0 ? process.userId : null;
  const processOwner = processUserName ??
    (processUserId === null ? null : t("UID {id}", { id: processUserId }));
  const showInterval = current && hasConnectionIntervalDelta(record);
  const intervalBytes = (value: bigint) => showInterval ? recordedBytes(value) : null;
  const route = ([
    ["Process", processPath || packages || processId || processOwner],
    ["Inbound", inbound],
    ["Matched rule", rule],
    ["Outbound chain", chain],
    ["Destination", destination],
  ] as const).filter(([, value]) => value);
  const fields: [label: string, value: ReactNode, copyLabel?: string][] = [
    ["Connection ID", safe(record.id)],
    ["Inbound", inbound],
    ["Inbound type", safe(record.inboundType)],
    ["Outbound", safe(record.outbound)],
    ["Outbound type", safe(record.outboundType)],
    ["From outbound", safe(record.fromOutbound)],
    ["IP version", record.ipVersion === 4 || record.ipVersion === 6 ? `IPv${record.ipVersion}` : null],
    ["Network", safe(record.network)],
    ["Protocol", safe(record.protocol)],
    ["User", safe(record.user)],
    ["Source address", source, "Copy source address"],
    ["Destination address", destination, "Copy destination address"],
    ["Domain", domain, "Copy domain"],
    ["Matched rule", rule, "Copy rule"],
    ["Outbound chain", chain, "Copy outbound chain"],
    ["Process ID", processId],
    ["Process user ID", processUserId],
    ["Process user name", processUserName],
    ["Process path", processPath],
    ["Package names", packages],
    ["Created at", recordedTime(record.createdAt, dateFormat)],
    ["Closed at", recordedTime(record.closedAt, dateFormat)],
    ["Upload total", recordedBytes(record.uplinkTotal)],
    ["Download total", recordedBytes(record.downlinkTotal)],
    ["Upload in reported interval", intervalBytes(record.uplink)],
    ["Download in reported interval", intervalBytes(record.downlink)],
  ];

  async function copy(value: string) {
    setFeedback("");
    try {
      await navigator.clipboard.writeText(value);
      setFeedback("Copied to clipboard.");
    } catch {
      setFeedback("Clipboard unavailable.");
    }
  }

  return (
    <div className="flex min-h-0 flex-col">
      {!current && <p className="pb-2 text-muted-foreground">{t("Retained data may be stale.")}</p>}
      <p className="text-muted-foreground" role="status">{feedback && t(feedback)}</p>
      <div
        role="region"
        aria-label={t("Reported connection fields")}
        tabIndex={0}
        className="grid min-h-0 gap-4 overflow-y-auto rounded-sm pr-1"
      >
        <section aria-label={t("Route")} className="grid gap-2 rounded-lg border p-3">
          <h3 className="font-medium">{t("Route")}</h3>
          {route.length ? (
            <ol role="list" className="flex flex-wrap gap-2">
              {route.map(([label, value], index) => (
                <li key={label} className="flex min-w-0 gap-2">
                  {index > 0 && <ArrowRight aria-hidden="true" className="size-3 shrink-0 self-center text-muted-foreground" />}
                  <span className="min-w-0 wrap-anywhere font-medium">
                    <span className="block text-xs font-normal text-muted-foreground">{t(label)}</span>
                    {value}
                  </span>
                </li>
              ))}
            </ol>
          ) : <p className="text-muted-foreground">{t("Unavailable")}</p>}
          {onInspectOutbound && (
            <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={onInspectOutbound}>
              {t("View reported outbound")}
            </Button>
          )}
        </section>
        <dl className="grid gap-3 sm:grid-cols-2">
          {fields.map(([label, value, copyLabel]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t(label)}</dt>
              <dd className="flex min-w-0 items-start gap-1">
                <span className="min-w-0 wrap-anywhere">{value ?? t("Unavailable")}</span>
                {copyLabel && typeof value === "string" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0"
                    aria-label={t(copyLabel)}
                    title={t(copyLabel)}
                    onClick={() => void copy(value)}
                  >
                    <Copy aria-hidden="true" />
                  </Button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
