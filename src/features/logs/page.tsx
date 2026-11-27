import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Pause, Play, Search, Trash2 } from "lucide-react";
import { useWorkspace } from "@/app/context";
import { hasCurrentLogs, LOG_LIMIT, type LogEntry } from "@/api/state";
import {
  ChannelState,
  Choice,
  Notice,
  PageHeading,
  Panel,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { LogLine } from "./log-line";
import { logSource } from "./log-source";
import { LogLevel } from "@/proto/daemon/started_service_pb";
import { levelName } from "@/lib/format";
import { useAction } from "@/hooks/use-action";

const logPageSize = 200;

export default function Logs() {
  const { snapshot, session, t } = useWorkspace();
  const [search, setSearch] = useState(""),
    [level, setLevel] = useState(String(LogLevel.INFO)),
    [source, setSource] = useState("all"),
    [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState<LogEntry[] | null>(null);
  const [requestedPage, setLogPage] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const coreClear = useAction();
  const canClearCore = hasCurrentLogs(snapshot) && !coreClear.pending;
  const viewport = useRef<HTMLDivElement>(null);
  const searchText = search.toLowerCase();
  const query = useDeferredValue(searchText);
  const logs = paused ?? snapshot.logs;
  const entries = useMemo(() => {
    const threshold = level === "all" ? Infinity : Number(level);
    return logs.filter(
      (log) =>
        log.level <= threshold &&
        (!query || log.text.toLowerCase().includes(query)) &&
        (source === "all" || logSource(log.text) === source),
    );
  }, [logs, level, query, source]);
  const canCopyOrExport = query === searchText && entries.length > 0;
  const logPage = Math.min(requestedPage, Math.max(0, Math.ceil(entries.length / logPageSize) - 1));
  const pageEnd = entries.length - logPage * logPageSize;
  const pageStart = Math.max(0, pageEnd - logPageSize);
  const visibleEntries = entries.slice(pageStart, pageEnd);
  const endId = visibleEntries.at(-1)?.id;
  useEffect(() => {
    if (autoScroll && !paused && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [endId, autoScroll, paused]);
  function showLogPage(page: number) {
    // Hold the current buffer so incoming logs cannot move the rows being read.
    if (!paused && page > 0) setPaused(logs);
    setLogPage(page);
    if (viewport.current) viewport.current.scrollTop = 0;
  }
  const text = () =>
    entries
      .map(
        (entry) =>
          `${new Date(entry.receivedAt).toISOString()} ${levelName(entry.level)} ${entry.text}`,
      )
      .join("\n");
  async function copy() {
    if (!canCopyOrExport) return;
    try {
      await navigator.clipboard.writeText(text());
      setFeedback("Filtered logs copied.");
    } catch {
      setFeedback("Clipboard unavailable. Use Export to save filtered logs.");
    }
  }
  function download() {
    if (!canCopyOrExport) return;
    const url = URL.createObjectURL(
      new Blob([text()], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `singdeck-logs-${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setFeedback("Filtered logs exported.");
  }
  async function clearCoreBuffer() {
    if (await coreClear.run(session.clearCoreLogs)) {
      setConfirmClear(false);
      setPaused(null);
      setLogPage(0);
      setFeedback("Core log buffer clear requested.");
    }
  }
  return (
    <>
      <PageHeading title={t("Logs")} />
      <div className="toolbar">
        <div className="search-field">
          <Search />
          <Input
            aria-label={t("Search logs")}
            placeholder={t("Search log messages…")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLogPage(0);
            }}
          />
        </div>
        <Choice
          label={t("Log level")}
          value={level}
          onChange={(value) => {
            setLevel(value);
            setLogPage(0);
          }}
          options={[
            { value: "all", label: t("All levels") },
            ...Array.from({ length: 7 }, (_, i) => ({
              value: String(i),
              label: t("{level} and above", { level: levelName(i) }),
            })),
          ]}
        />
        <Choice
          label={t("Log source")}
          value={source}
          onChange={(value) => {
            setSource(value);
            setLogPage(0);
          }}
          options={[
            { value: "all", label: t("All sources") },
            { value: "dns", label: "DNS" },
            { value: "inbound", label: t("Inbound") },
            { value: "outbound", label: t("Outbound") },
            { value: "router", label: t("Router") },
            { value: "other", label: t("Other") },
          ]}
        />
        <div className="button-row toolbar-actions">
          <Button
            variant="outline"
            onClick={() => {
              setPaused(paused ? null : logs);
              setLogPage(0);
            }}
          >
            {paused ? (
              <Play data-icon="inline-start" />
            ) : (
              <Pause data-icon="inline-start" />
            )}
            {t(paused ? "Resume" : "Pause")}
          </Button>
          <Field orientation="horizontal">
            <Switch
              id="auto-scroll"
              checked={autoScroll}
              onCheckedChange={setAutoScroll}
            />
            <FieldLabel htmlFor="auto-scroll">{t("Auto scroll")}</FieldLabel>
          </Field>
        </div>
      </div>
      {paused && (
        <Notice title={t("View paused")}>
          {t(
            "The stream continues into a bounded buffer. Resume to see the latest entries.",
          )}
        </Notice>
      )}
      <Panel
        title={t("Runtime stream")}
        description={t(
          "Core output level: {level} · View filter is independent · Local receipt times",
          {
            level:
              snapshot.defaultLogLevel === undefined
                ? t("unavailable")
                : levelName(snapshot.defaultLogLevel),
          },
        )}
        action={
          <div className="button-row">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Copy filtered logs")}
              onClick={() => void copy()}
              disabled={!canCopyOrExport}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Export filtered logs")}
              onClick={download}
              disabled={!canCopyOrExport}
            >
              <Download />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Clear local logs")}
              onClick={() => {
                session.clearLogs();
                if (paused) setPaused([]);
                setLogPage(0);
              }}
            >
              <Trash2 />
            </Button>
            <Dialog
              open={confirmClear}
              onOpenChange={(open) => {
                if (!coreClear.pending) setConfirmClear(open);
              }}
            >
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={!canClearCore}>
                  {t("Clear core buffer")}
                </Button>
              </DialogTrigger>
              <DialogContent
                closeLabel={t("Close")}
                showCloseButton={!coreClear.pending}
              >
                <DialogHeader>
                  <DialogTitle>{t("Clear the core log buffer?")}</DialogTitle>
                  <DialogDescription>
                    {t(
                      "This clears the in-memory log history shared by clients of this core. New messages will continue to arrive.",
                    )}
                  </DialogDescription>
                </DialogHeader>
                {coreClear.error && (
                  <Notice title="Core log clear failed">{coreClear.error}</Notice>
                )}
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline" disabled={coreClear.pending}>
                      {t("Cancel")}
                    </Button>
                  </DialogClose>
                  <Button
                    variant="destructive"
                    disabled={!canClearCore}
                    onClick={() => void clearCoreBuffer()}
                  >
                    {t("Clear core buffer")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      >
        <ChannelState channel="logs" empty={!entries.length}>
          <div
            className="log-console"
            ref={viewport}
            tabIndex={0}
            aria-label={t("Log messages")}
          >
            <div>
              {visibleEntries.map((entry) => (
                <LogLine
                  receiptLabel={t("Local receipt time")}
                  key={entry.id}
                  entry={entry}
                />
              ))}
            </div>
          </div>
        </ChannelState>
        <div className="panel-footer">
          <span>
            {t(
              "{count} shown · {limit} entry limit · 16K characters per message",
              { count: visibleEntries.length, limit: LOG_LIMIT.toLocaleString() },
            )}
          </span>
          {entries.length > logPageSize && (
            <div className="button-row" role="group" aria-label={t("Log history pages")}>
              <Button
                variant="outline"
                size="sm"
                disabled={pageStart === 0}
                onClick={() => showLogPage(logPage + 1)}
              >
                {t("Older logs")}
              </Button>
              <span aria-live="polite">
                {t("{first}–{last} of {count} matching logs", {
                  first: (pageStart + 1).toLocaleString(),
                  last: pageEnd.toLocaleString(),
                  count: entries.length.toLocaleString(),
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={logPage === 0}
                onClick={() => showLogPage(logPage - 1)}
              >
                {t("Newer logs")}
              </Button>
            </div>
          )}
          <span role="status">
            {t(feedback || (paused ? "Paused locally" : "Streaming"))}
          </span>
        </div>
      </Panel>
    </>
  );
}
