import type { Profile } from "@/features/instances/profiles";
import type { Connection } from "@/proto/daemon/started_service_pb";
import { redactNativeConnectionText } from "./redaction";

export function serializeConnectionExport(
  rows: readonly Connection[],
  source: Profile["mode"],
  exportedAt: Date,
  retentionLimitReached: boolean,
  redactText: (value: string) => string,
) {
  const redactNativeText = (value: string) => redactNativeConnectionText(value, redactText);
  const text = (value: string) => value ? redactNativeText(value) : null;
  const timestamp = (value: bigint) => value > 0n ? value.toString() : null;
  const bytes = (value: bigint) => value >= 0n ? value.toString() : null;

  return JSON.stringify({
    source,
    exportedAt: exportedAt.toISOString(),
    scope: "retained-matching-connections",
    snapshotCurrent: true,
    retentionLimitReached,
    units: { timestamps: "unix-ms", traffic: "bytes" },
    chainOrder: "leaf-first",
    connections: rows.map((row) => {
      const process = row.processInfo;
      return {
        id: text(row.id),
        inbound: text(row.inbound),
        inboundType: text(row.inboundType),
        outbound: text(row.outbound),
        outboundType: text(row.outboundType),
        fromOutbound: text(row.fromOutbound),
        ipVersion: row.ipVersion === 4 || row.ipVersion === 6 ? row.ipVersion : null,
        network: text(row.network),
        source: text(row.source),
        destination: text(row.destination),
        domain: text(row.domain),
        protocol: text(row.protocol),
        user: text(row.user),
        rule: text(row.rule),
        chainList: row.chainList.map(redactNativeText),
        processInfo: process ? {
          processId: process.processId > 0 ? process.processId : null,
          userId: process.userId >= 0 ? process.userId : null,
          userName: text(process.userName),
          processPath: text(process.processPath),
          packageNames: process.packageNames.map(redactNativeText),
        } : null,
        createdAt: timestamp(row.createdAt),
        closedAt: timestamp(row.closedAt),
        uplinkTotal: bytes(row.uplinkTotal),
        downlinkTotal: bytes(row.downlinkTotal),
      };
    }),
  }, null, 2);
}
