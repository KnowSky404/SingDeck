import { Badge } from "@/components/ui/badge";
import { time, levelName } from "@/lib/format";
import type { LogEntry } from "@/api/state";
export function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <div className="log-line">
      <time
        dateTime={new Date(entry.receivedAt).toISOString()}
        title="Local receipt time"
      >
        {time(entry.receivedAt)}
      </time>
      <Badge variant={entry.level < 3 ? "destructive" : "secondary"}>
        {levelName(entry.level)}
      </Badge>
      <span>{entry.message}</span>
    </div>
  );
}
