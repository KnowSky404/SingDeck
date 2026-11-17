import type { GroupItem } from "@/proto/daemon/started_service_pb";

export function latency(item: GroupItem): string {
  if (item.urlTestTime === 0n) return "No result";
  return item.urlTestDelay < 0 ? "Invalid result" : `${item.urlTestDelay} ms`;
}
