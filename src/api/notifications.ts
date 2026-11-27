import type { NotificationEvent } from "@/proto/daemon/started_service_pb";
import { plainLog } from "@/lib/ansi";

export const NOTIFICATION_LIMIT = 100;
export const localNotifications = {
  serviceFatal: { title: "The core reported a fatal service error.", level: "error", destination: "/logs" },
  apiConnection: { title: "The API connection was interrupted or failed.", level: "error", destination: "/settings" },
  configuration: { title: "The core reported configuration deprecations.", level: "warning", destination: "/configuration-health" },
  networkQualityCompleted: { title: "Network quality test completed.", level: "info", destination: "/diagnostics" },
  networkQualityFailed: { title: "Network quality test failed.", level: "error", destination: "/diagnostics" },
  stunCompleted: { title: "STUN test completed.", level: "info", destination: "/diagnostics" },
  stunFailed: { title: "STUN test failed.", level: "error", destination: "/diagnostics" },
  selectionFailed: { title: "Outbound selection failed.", level: "error", destination: "/proxies" },
} as const;

export type LocalNotification = keyof typeof localNotifications;
export type NotificationLevel = (typeof localNotifications)[LocalNotification]["level"];
type NotificationContent =
  | { source: "local"; kind: LocalNotification }
  | { source: "native"; title: string; subtitle: string; body: string; canceled?: boolean };
export type NotificationEntry = NotificationContent & {
  id: string;
  sequence: number;
  receivedAt: number;
  count: number;
  read: boolean;
};
export type NotificationRecord = NotificationEntry & { nativeIdentity?: string };

export function visibleNotifications(history: NotificationRecord[]): NotificationEntry[] {
  return history.map((record) => {
    const entry = { ...record };
    delete entry.nativeIdentity;
    return entry;
  });
}

function receive(
  history: NotificationRecord[],
  id: string,
  content: NotificationContent,
  receivedAt: number,
  sequence: number,
  nativeIdentity?: string,
): NotificationRecord[] {
  const previous = history.find((entry) => entry.id === id);
  const count = previous && !(previous.source === "native" && previous.canceled) ? previous.count + 1 : 1;
  return [
    { ...content, id, receivedAt, sequence, count, read: false, nativeIdentity },
    ...history.filter((entry) => entry.id !== id).slice(0, NOTIFICATION_LIMIT - 1),
  ];
}

export function receiveLocalNotification(
  history: NotificationRecord[], kind: LocalNotification, receivedAt: number, sequence: number,
) {
  return receive(history, `local:${kind}`, { source: "local", kind }, receivedAt, sequence);
}

const credential = /\bbearer\s+\S|\b(?:authorization|(?:set[-_])?cookie|passwd|password|(?:client[-_ ]?)?secret|(?:x[-_])?api[-_ ]?key|(?:(?:access|refresh|id)[-_ ]?)?token)["']?\s*[:=]/iu;
const url = /\/\/\S|\b(?:https?|file|mailto|data|javascript|vbscript|sing-box):\S/iu;

export function safeNativeText(value: string, redact: (value: string) => string, limit: number) {
  if (value.length > 8192) return "";
  if (redact(value) !== value) return "[redacted]";
  // Controls and formatting must not conceal credential and URL markers.
  const plain = plainLog(value).replace(/[\p{Cc}\p{Cf}]/gu, " ");
  let text = plain;
  for (let depth = 0; depth <= 2; depth++) {
    if (redact(text) !== text || credential.test(text) || url.test(text)) return "[redacted]";
    if (depth === 2 || !text.includes("%")) break;
    // Decode without treating literal plus signs and ampersands as form data.
    const decoded = new URLSearchParams(`text=${text.replaceAll("+", "%2B").replaceAll("&", "%26")}`).get("text");
    if (decoded === null || decoded === text) break;
    text = decoded;
  }
  return plain.trim().slice(0, limit);
}

export function receiveNativeNotification(
  history: NotificationRecord[], event: NotificationEvent, receivedAt: number, sequence: number,
  redact: (value: string) => string,
) {
  const { value } = event.event;
  if (!value?.identifier || value.identifier.length > 512) return history;
  const nativeIdentity = JSON.stringify([value.typeID, value.identifier]);
  if (event.event.case === "cancel") {
    return history.map((entry) => entry.nativeIdentity === nativeIdentity && entry.source === "native" && !entry.canceled
      ? { ...entry, canceled: true, read: true }
      : entry);
  }
  if (event.event.case !== "send") return history;
  const notification = event.event.value;
  const id = history.find((entry) => entry.nativeIdentity === nativeIdentity)?.id ?? `native:${sequence}`;
  return receive(history, id, {
    source: "native",
    title: safeNativeText(notification.title, redact, 160),
    subtitle: safeNativeText(notification.subtitle, redact, 240),
    body: safeNativeText(notification.body, redact, 1000),
  }, receivedAt, sequence, nativeIdentity);
}

export function setNotificationRead(history: NotificationRecord[], read: boolean, id?: string) {
  return history.map((entry) => ((!id || entry.id === id) && entry.read !== read &&
    (read || entry.source !== "native" || !entry.canceled))
    ? { ...entry, read }
    : entry);
}

export function dismissNotification(history: NotificationRecord[], id: string) {
  return history.filter((entry) => entry.id !== id);
}
