import { useEffect, useMemo, useState } from "react";
import type { RuntimeSample } from "@/api/runtime";

export const runtimeWindows = [
  { value: "60", label: "1 minute" },
  { value: "180", label: "3 minutes" },
  { value: "300", label: "5 minutes" },
];

export function useRuntimeWindow(samples: RuntimeSample[], initialSeconds: number) {
  const [{ windowSeconds, clock }, setWindow] = useState(() => ({
    windowSeconds: String(initialSeconds),
    clock: Date.now(),
  }));
  const windowMs = Number(windowSeconds) * 1000;
  const cutoff = Math.max(clock, samples.at(-1)?.time ?? 0) - windowMs;
  const visible = useMemo(
    () => samples.filter(({ time }) => time > cutoff),
    [samples, cutoff],
  );
  const first = visible[0]?.time;
  useEffect(() => {
    if (first === undefined) return;
    const expiresAt = first + windowMs;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = Date.now();
      setWindow((current) => ({ ...current, clock: now }));
      if (now < expiresAt) timer = setTimeout(refresh, expiresAt - now);
    };
    timer = setTimeout(refresh, Math.max(0, expiresAt - Date.now()));
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [first, windowMs]);
  function selectWindow(seconds: string) {
    // An empty window has no expiry timer to keep its clock current.
    setWindow({ windowSeconds: seconds, clock: Date.now() });
  }
  return { samples: visible, windowSeconds, selectWindow };
}
