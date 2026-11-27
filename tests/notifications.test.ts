import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { NotificationEventSchema } from "@/proto/daemon/started_service_pb";
import {
  dismissNotification,
  NOTIFICATION_LIMIT,
  receiveLocalNotification,
  receiveNativeNotification,
  setNotificationRead,
  type NotificationEntry,
} from "@/api/notifications";

const redact = (text: string) => text.replaceAll("demo-marker", "[redacted]");
const send = (identifier: string, typeID = 1) => create(NotificationEventSchema, {
  event: { case: "send", value: {
    identifier, typeID,
    title: "<img src=https://unsafe.example/private>",
    subtitle: "value=demo%2Dmarker",
    body: "ANSI: \x1b[31mdemo-marker\x1b[0m",
    openURL: "javascript:alert('unused')",
  } },
});

describe("notification history", () => {
  it("keeps source identity, reads, and native cancellation independent", () => {
    const local = receiveLocalNotification([], "selectionFailed", 1, 1);
    const mix = receiveNativeNotification(local, send("selectionFailed"), 2, 2, redact);
    expect(mix[0]).toMatchObject({
      source: "native", title: "<img src=[redacted]", subtitle: "[redacted]", body: "ANSI: [redacted]",
    });
    expect(mix[0]).not.toHaveProperty("openURL");
    const [native] = mix;
    const read = setNotificationRead(mix, true, native.id);
    const repeat = receiveNativeNotification(read, send("selectionFailed"), 3, 3, redact);
    expect(repeat[0]).toMatchObject({ count: 2, read: false });
    const other = receiveNativeNotification(repeat, send("selectionFailed", 2), 4, 4, redact);
    const cancel = create(NotificationEventSchema, { event: { case: "cancel", value: { identifier: "selectionFailed", typeID: 1 } } });
    const canceled = receiveNativeNotification(other, cancel, 5, 5, redact);
    expect(canceled).toHaveLength(3);
    expect(canceled.find((entry) => entry.id === native.id)).toMatchObject({ canceled: true, read: true });
    expect(canceled[0]).toMatchObject({ count: 1, read: false });
    expect(setNotificationRead(canceled, false, native.id)).toEqual(canceled);
    expect(setNotificationRead(canceled, true).every((entry) => entry.read)).toBe(true);
    const dismissed = dismissNotification(canceled, native.id);
    expect(receiveNativeNotification(dismissed, cancel, 6, 6, redact)).toEqual(dismissed);
    expect(receiveNativeNotification(canceled, send("selectionFailed"), 7, 7, redact)[0])
      .toMatchObject({ count: 1, read: false });
  });

  it("bounds memory and drops incomplete or oversized identities", () => {
    let history: NotificationEntry[] = [];
    for (let i = 0; i < NOTIFICATION_LIMIT + 5; i++) {
      history = receiveNativeNotification(history, send(`row-${i}`), i, i, redact);
    }
    expect(history).toHaveLength(NOTIFICATION_LIMIT);
    expect(history.at(-1)?.sequence).toBe(5);
    expect(receiveNativeNotification(history, send(""), 200, 200, redact)).toBe(history);
    expect(receiveNativeNotification(history, send("x".repeat(513)), 200, 200, redact)).toBe(history);
  });
});
