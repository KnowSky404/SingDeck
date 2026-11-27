import type { NetworkQualityTestProgress, STUNTestProgress } from "@/proto/daemon/started_service_pb";
import { accuracyLabels, filteringLabels, mappingLabels } from "@/api/diagnostics";

export function validateDiagnosticTarget(value: string, networkQuality: boolean) {
  if (!value) return true;
  try {
    if (/[\\\s]/.test(value)) return false;
    if (!networkQuality) {
      const ipv6 = value.indexOf(":") !== value.lastIndexOf(":");
      if (/[/?#@%]/.test(value) || (!ipv6 && value.endsWith(":"))) return false;
      const authority = ipv6 && !value.startsWith("[") ? `[${value}]` : value;
      const url = new URL(`http://${authority}`);
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

export type CapacityTrace = {
  elapsedMs: bigint;
  announced: Set<number>;
  download?: bigint;
  upload?: bigint;
  downloadRPM?: number;
  uploadRPM?: number;
};

export type CapacitySample = {
  elapsed: number;
  download?: number;
  upload?: number;
};

export function capacitySample(
  message: NetworkQualityTestProgress,
  serial: boolean,
  trace: CapacityTrace,
): CapacitySample | undefined {
  const { phase, elapsedMs, downloadCapacity, uploadCapacity, downloadRPM, uploadRPM } = message;
  if (phase < 1 || phase > 3) return;

  // The first frame of each direction announces the phase, while later frames report samples.
  const directionalSample = trace.announced.has(phase);
  trace.announced.add(phase);
  // Parallel frames can contain an older snapshot of the other worker's values.
  const downloadReported = phase === 3 || (serial && phase === 2) || (phase === 1 && directionalSample);
  const uploadReported = phase === 3 || (phase === 2 && directionalSample);
  if (downloadReported) {
    trace.download = downloadCapacity;
    trace.downloadRPM = downloadRPM;
  }
  if (uploadReported) {
    trace.upload = uploadCapacity;
    trace.uploadRPM = uploadRPM;
  }
  if (elapsedMs > trace.elapsedMs) trace.elapsedMs = elapsedMs;
  if (trace.elapsedMs <= 0n || (!downloadReported && !uploadReported)) return;
  return {
    elapsed: Number(trace.elapsedMs) / 1000,
    download: trace.download === undefined ? undefined : Number(trace.download) / 1e6,
    upload: trace.upload === undefined ? undefined : Number(trace.upload) / 1e6,
  };
}

export function bitrate(value: bigint | undefined) {
  if (value === undefined || value < 0n) return "—";
  if (value === 0n) return "0 bit/s";
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
    downloadRPM: value.downloadRPM > 0 ? value.downloadRPM : null,
    uploadRPM: value.uploadRPM > 0 ? value.uploadRPM : null,
    idleLatencyMs: value.idleLatencyMs,
    elapsedMs,
    downloadCapacityAccuracy: accuracyLabels[value.downloadCapacityAccuracy] ?? "Unknown",
    uploadCapacityAccuracy: accuracyLabels[value.uploadCapacityAccuracy] ?? "Unknown",
    downloadRPMAccuracy: value.downloadRPM > 0 ? accuracyLabels[value.downloadRPMAccuracy] ?? "Unknown" : undefined,
    uploadRPMAccuracy: value.uploadRPM > 0 ? accuracyLabels[value.uploadRPMAccuracy] ?? "Unknown" : undefined,
  };
}
