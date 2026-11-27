import type {
  NetworkQualityTestProgress,
  STUNTestProgress,
} from "@/proto/daemon/started_service_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  NetworkQualityTestRequestSchema,
  STUNTestRequestSchema,
} from "@/proto/daemon/started_service_pb";

interface DiagnosticMessages {
  networkQuality: NetworkQualityTestProgress;
  stun: STUNTestProgress;
}
export type DiagnosticName = keyof DiagnosticMessages;
export type DiagnosticProgress<K extends DiagnosticName> = DiagnosticMessages[K];
export type NetworkQualityRequest = MessageInitShape<typeof NetworkQualityTestRequestSchema>;
export type STUNRequest = MessageInitShape<typeof STUNTestRequestSchema>;

export const networkQualityPhases = ["Idle", "Download", "Upload", "Done"];
export const stunPhases = ["Binding", "Mapping", "Filtering", "Done"];
export const accuracyLabels = ["Low", "Medium", "High"];
export const mappingLabels = [
  "Unknown",
  "Reserved",
  "Endpoint-independent",
  "Address-dependent",
  "Address and port-dependent",
];
export const filteringLabels = [
  "Unknown",
  "Endpoint-independent",
  "Address-dependent",
  "Address and port-dependent",
];

export class DiagnosticExecutionError extends Error {
  constructor() {
    super("The core could not complete this diagnostic.");
  }
}
