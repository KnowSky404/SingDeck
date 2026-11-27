import type { NetworkQualityTestProgress, STUNTestProgress } from "@/proto/daemon/started_service_pb";
import { accuracyLabels, filteringLabels, mappingLabels } from "@/api/diagnostics";

export function validateDiagnosticTarget(value: string, networkQuality: boolean) {
  if (!value) return true;
  try {
    if (/[\\\s]/.test(value)) return false;
    if (!networkQuality) {
      if (/[/?#@%]/.test(value) || value.endsWith(":")) return false;
      const url = new URL(`http://${value}`);
      return Boolean(url.hostname) && url.port !== "0";
    }
    const hasScheme = value.includes("://");
    if (!hasScheme && /[/#?]/.test(value)) return false;
    const url = new URL(hasScheme ? value : `https://${value}`);
    return /^(https?):$/.test(url.protocol) && Boolean(url.hostname) &&
      !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export function bitrate(value: bigint | undefined) {
  if (value === undefined || value <= 0n) return "—";
  const number = Number(value);
  const unit = Math.min(Math.floor(Math.log10(number) / 3), 4);
  return `${(number / 1000 ** unit).toFixed(unit === 0 ? 0 : 1)} ${["bit/s", "kbit/s", "Mbit/s", "Gbit/s", "Tbit/s"][unit]}`;
}

export function diagnosticMeasurement(
  value: NetworkQualityTestProgress | STUNTestProgress,
  elapsedMs: number | undefined,
) {
  if (value.$typeName === "daemon.STUNTestProgress") {
    return {
      externalAddress: value.externalAddr,
      latencyMs: value.latencyMs,
      natBehaviorSupported: value.natTypeSupported,
      natMapping: mappingLabels[value.natMapping] ?? "Unknown",
      natFiltering: filteringLabels[value.natFiltering] ?? "Unknown",
    };
  }
  return {
    downloadBitsPerSecond: value.downloadCapacity.toString(),
    uploadBitsPerSecond: value.uploadCapacity.toString(),
    downloadRPM: value.downloadRPM,
    uploadRPM: value.uploadRPM,
    idleLatencyMs: value.idleLatencyMs,
    elapsedMs,
    downloadCapacityAccuracy: accuracyLabels[value.downloadCapacityAccuracy] ?? "Unknown",
    uploadCapacityAccuracy: accuracyLabels[value.uploadCapacityAccuracy] ?? "Unknown",
    downloadRPMAccuracy: accuracyLabels[value.downloadRPMAccuracy] ?? "Unknown",
    uploadRPMAccuracy: accuracyLabels[value.uploadRPMAccuracy] ?? "Unknown",
  };
}
