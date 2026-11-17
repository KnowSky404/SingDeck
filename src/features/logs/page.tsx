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
import { levelName } from "@/lib/format";

export default function Logs() {
  const { snapshot, session } = useWorkspace();
  const [search, setSearch] = useState(""),
    [level, setLevel] = useState("all"),
    [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState<LogEntry[] | null>(null);
  const [feedback, setFeedback] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const query = useDeferredValue(search.toLowerCase());
  const entries = (paused ?? snapshot.logs).filter(
    (log) =>
      (level === "all" || log.level === Number(level)) &&
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
      <PageHeading
        title="Logs"
        description="A live view into your instance."
        action={
          <Button
            variant="outline"
            onClick={() => setPaused(paused ? null : [...snapshot.logs])}
          >
            {paused ? (
              <Play data-icon="inline-start" />
            ) : (
              <Pause data-icon="inline-start" />
            )}
            {paused ? "Resume" : "Pause"}
          </Button>
        }
      />
      <div className="toolbar">
        <div className="search-field">
          <Search />
          <Input
            aria-label="Search logs"
            placeholder="Search log messages…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Choice
          label="Log level"
          value={level}
          onChange={setLevel}
          options={[
            { value: "all", label: "All levels" },
            ...Array.from({ length: 7 }, (_, i) => ({
              value: String(i),
              label: levelName(i),
            })),
          ]}
        />
        <Field orientation="horizontal">
          <Switch
            id="auto-scroll"
            checked={autoScroll}
            onCheckedChange={setAutoScroll}
          />
          <FieldLabel htmlFor="auto-scroll">Auto scroll</FieldLabel>
        </Field>
      </div>
      {paused && (
        <Notice title="View paused">
          The stream continues into a bounded buffer. Resume to see the latest
          entries.
        </Notice>
      )}
      <Panel
        title="Runtime stream"
        description={`Default level: ${snapshot.defaultLogLevel === undefined ? "unavailable" : levelName(snapshot.defaultLogLevel)} · Timestamps are local receipt times`}
        action={
          <div className="button-row">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy filtered logs"
              onClick={() => void copy()}
              disabled={!entries.length}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Export filtered logs"
              onClick={download}
              disabled={!entries.length}
            >
              <Download />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear local logs"
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
            aria-label="Log messages"
          >
            <div>
              {entries.map((entry) => (
                <LogLine key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        </ChannelState>
        <div className="panel-footer">
          <span>
            {entries.length} shown · {LOG_LIMIT.toLocaleString()} entry limit ·
            16K characters per message
          </span>
          <span role="status">
            {feedback || (paused ? "Paused locally" : "Streaming")}
          </span>
        </div>
      </Panel>
    </>
  );
}
