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
    const expiresAt = first + windowMs;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = Date.now();
      setClock(now);
      if (now < expiresAt) timer = setTimeout(refresh, expiresAt - now);
    };
    timer = setTimeout(refresh, Math.max(0, expiresAt - Date.now()));
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [first, windowMs]);
  return visible;
}
