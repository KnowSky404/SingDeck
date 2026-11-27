import type { Connection } from "@/proto/daemon/started_service_pb";

export const defaultConnectionFilters = {
  status: "active",
  network: "all",
  outbound: null as string | null,
  ipVersion: "all",
  inbound: "",
  protocol: "",
  domain: "",
  rule: "",
  process: "",
  user: "",
};

export type ConnectionFilters = typeof defaultConnectionFilters;

const metadataFilters = ["inbound", "protocol", "domain", "rule", "user"] as const;
const normalize = (value: string) => value.trim().toLowerCase();

export function hasNarrowingConnectionFilter(filters: ConnectionFilters, search: string) {
  return Boolean(search.trim() || filters.network !== "all" || filters.outbound !== null ||
    filters.ipVersion !== "all" || filters.process.trim() ||
    metadataFilters.some((field) => filters[field].trim()));
}

export function connectionMatcher(filters: ConnectionFilters, search: string) {
  const { status, network, outbound, ipVersion } = filters;
  const metadata = metadataFilters.flatMap((field) => {
    const value = normalize(filters[field]);
    return value ? [[field, value] as const] : [];
  });
  const process = normalize(filters.process);
  const terms = normalize(search).split(/\s+/).filter(Boolean);

  return (connection: Connection) => {
    if (
      (status !== "all" &&
        (status === "closed" ? connection.closedAt <= 0n : connection.closedAt !== 0n)) ||
      (network !== "all" && connection.network !== network) ||
      (outbound !== null && connection.outbound !== outbound) ||
      (ipVersion !== "all" && String(connection.ipVersion) !== ipVersion) ||
      !metadata.every(([field, value]) => connection[field].toLowerCase().includes(value))
    ) {
      return false;
    }
    if (!process && terms.length === 0) return true;

    const info = connection.processInfo;
    const processValues = info
      ? [
          info.processPath,
          ...info.packageNames,
          info.processId > 0 ? String(info.processId) : "",
        ]
      : [];
    if (process && !processValues.some((value) => value.toLowerCase().includes(process))) {
      return false;
    }
    if (terms.length === 0) return true;

    const searchText = [
      connection.id,
      connection.domain,
      connection.destination,
      connection.source,
      connection.inbound,
      connection.inboundType,
      connection.outbound,
      connection.outboundType,
      connection.fromOutbound,
      connection.network,
      connection.protocol,
      connection.rule,
      connection.user,
      connection.ipVersion === 4 || connection.ipVersion === 6
        ? `IPv${connection.ipVersion}`
        : "",
      ...connection.chainList,
      ...processValues,
    ].join("\n").toLowerCase();
    return terms.every((term) => searchText.includes(term));
  };
}
