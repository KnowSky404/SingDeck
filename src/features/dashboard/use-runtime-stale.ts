import { useEffect, useState } from "react";
import { runtimeStaleIntervals } from "@/api/runtime";
import type { Snapshot } from "@/api/state";

export function useRuntimeStale(snapshot: Snapshot, intervalMs: number) {
  const { phase, runtime, streamErrors } = snapshot;
  const latest = runtime.samples.at(-1);
  const lastStatus = runtime.lastFrameAt.status;
  const expiresAt = lastStatus === undefined ? undefined : lastStatus + intervalMs * runtimeStaleIntervals;
  const [expired, setExpired] = useState(() =>
    expiresAt !== undefined && Date.now() >= expiresAt ? latest : undefined,
  );
  useEffect(() => {
    if (!latest || expiresAt === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      if (!document.hidden) {
        timer = setTimeout(() => setExpired(latest), Math.max(0, expiresAt - Date.now()));
      }
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [expiresAt, latest]);
  return Boolean(latest && (
    expired === latest || phase !== "connected" || streamErrors.status || runtime.awaitingPostRestartSample
  ));
}
