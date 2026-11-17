export function bytes(value: bigint | number | undefined): string {
  if (value === undefined) return "—";
  const number = Math.max(0, Number(value));
  if (!Number.isFinite(number)) return "—";
  if (number < 1000) return `${Math.round(number)} B`;
  const unit = Math.min(Math.floor(Math.log10(number) / 3), 4);
  return `${(number / 1000 ** unit).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}
export function time(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour12: false });
}
export function uptime(startedAt?: bigint): string {
  if (!startedAt || startedAt <= 0n) return "Unavailable";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Number(startedAt)) / 60000),
  );
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function levelName(level: number) {
  return (
    ["PANIC", "FATAL", "ERROR", "WARN", "INFO", "DEBUG", "TRACE"][level] ??
    "UNKNOWN"
  );
}
