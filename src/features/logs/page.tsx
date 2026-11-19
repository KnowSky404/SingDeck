import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Copy, Download, Pause, Play, Search, Trash2 } from "lucide-react";
import { useWorkspace } from "@/app/context";
import { LOG_LIMIT, type LogEntry } from "@/api/state";
import {
  ChannelState,
  Choice,
  Notice,
  PageHeading,
  Panel,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel } from "@/components/ui/field";
import { LogLine } from "./log-line";
import { LogLevel } from "@/proto/daemon/started_service_pb";
import { levelName } from "@/lib/format";

export default function Logs() {
  const { snapshot, session, t } = useWorkspace();
  const [search, setSearch] = useState(""),
    [level, setLevel] = useState(String(LogLevel.INFO)),
    [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState<LogEntry[] | null>(null);
  const [feedback, setFeedback] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const query = useDeferredValue(search.toLowerCase());
  const entries = (paused ?? snapshot.logs).filter(
    (log) =>
      (level === "all" || log.level <= Number(level)) &&
      log.text.toLowerCase().includes(query),
  );
  const endId = entries.at(-1)?.id;
  useEffect(() => {
    if (autoScroll && !paused && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [endId, autoScroll, paused]);
  const text = () =>
    entries
      .map(
        (entry) =>
          `${new Date(entry.receivedAt).toISOString()} ${levelName(entry.level)} ${entry.text}`,
      )
      .join("\n");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text());
      setFeedback("Filtered logs copied.");
    } catch {
      setFeedback("Clipboard unavailable. Use Export to save filtered logs.");
    }
  }
  function download() {
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
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Choice
          label={t("Log level")}
          value={level}
          onChange={setLevel}
          options={[
            { value: "all", label: t("All levels") },
            ...Array.from({ length: 7 }, (_, i) => ({
              value: String(i),
              label: t("{level} and above", { level: levelName(i) }),
            })),
          ]}
        />
        <div className="button-row toolbar-actions">
          <Button
            variant="outline"
            onClick={() => setPaused(paused ? null : [...snapshot.logs])}
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
              disabled={!entries.length}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Export filtered logs")}
              onClick={download}
              disabled={!entries.length}
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
              }}
            >
              <Trash2 />
            </Button>
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
              {entries.map((entry) => (
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
              { count: entries.length, limit: LOG_LIMIT.toLocaleString() },
            )}
          </span>
          <span role="status">
            {t(feedback || (paused ? "Paused locally" : "Streaming"))}
          </span>
        </div>
      </Panel>
    </>
  );
}
