import { useEffect, useMemo, useState } from "react";
import type { RuntimeSample } from "@/api/runtime";

export function useRuntimeWindow(samples: RuntimeSample[], seconds: number) {
  const [clock, setClock] = useState(Date.now);
  const windowMs = seconds * 1000;
  const cutoff = Math.max(clock, samples.at(-1)?.time ?? 0) - windowMs;
  const visible = useMemo(
    () => samples.filter(({ time }) => time > cutoff),
    [samples, cutoff],
  );
  const first = visible[0]?.time;
  useEffect(() => {
    if (first === undefined) return;
    const refresh = () => setClock(Date.now());
    const timer = setTimeout(refresh, Math.max(0, first + windowMs - Date.now()));
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [first, windowMs]);
  return visible;
}
