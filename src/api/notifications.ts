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

function receive(
  history: NotificationEntry[],
  id: string,
  content: NotificationContent,
  receivedAt: number,
  sequence: number,
): NotificationEntry[] {
  const previous = history.find((entry) => entry.id === id);
  const count = previous && !(previous.source === "native" && previous.canceled) ? previous.count + 1 : 1;
  return [
    { ...content, id, receivedAt, sequence, count, read: false },
    ...history.filter((entry) => entry.id !== id).slice(0, NOTIFICATION_LIMIT - 1),
  ];
}

export function receiveLocalNotification(
  history: NotificationEntry[], kind: LocalNotification, receivedAt: number, sequence: number,
) {
  return receive(history, `local:${kind}`, { source: "local", kind }, receivedAt, sequence);
}

function safeNativeText(value: string, redact: (value: string) => string, limit: number) {
  if (value.length > 8192) return "";
  // Control characters and bidi overrides could obscure what a native message displays.
  const plain = plainLog(value).replace(/[\p{Cc}\p{Cf}]/gu, " ");
  const decoded = new URLSearchParams(`text=${plain.replaceAll("+", "%2B").replaceAll("&", "%26")}`).get("text");
  if (decoded && decoded !== plain && redact(decoded) !== decoded) return "[redacted]";
  return redact(plain).replace(/\b[a-z][a-z\d+.-]*:\/\/\S+/giu, "[redacted]").trim().slice(0, limit);
}

export function receiveNativeNotification(
  history: NotificationEntry[], event: NotificationEvent, receivedAt: number, sequence: number,
  redact: (value: string) => string,
) {
  const { value } = event.event;
  if (!value?.identifier || value.identifier.length > 512) return history;
  const id = `native:${JSON.stringify([value.typeID, value.identifier])}`;
  if (event.event.case === "cancel") {
    return history.map((entry) => entry.id === id && entry.source === "native" && !entry.canceled
      ? { ...entry, canceled: true, read: true }
      : entry);
  }
  if (event.event.case !== "send") return history;
  const notification = event.event.value;
  return receive(history, id, {
    source: "native",
    title: safeNativeText(notification.title, redact, 160),
    subtitle: safeNativeText(notification.subtitle, redact, 240),
    body: safeNativeText(notification.body, redact, 1000),
  }, receivedAt, sequence);
}

export function setNotificationRead(history: NotificationEntry[], read: boolean, id?: string) {
  return history.map((entry) => ((!id || entry.id === id) && entry.read !== read &&
    (read || entry.source !== "native" || !entry.canceled))
    ? { ...entry, read }
    : entry);
}

export function dismissNotification(history: NotificationEntry[], id: string) {
  return history.filter((entry) => entry.id !== id);
}
