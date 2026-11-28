import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { NotificationEventSchema } from "@/proto/daemon/started_service_pb";
import {
  dismissNotification,
  localNotifications,
  NOTIFICATION_LIMIT,
  receiveLocalNotification,
  receiveNativeNotification,
  setNotificationRead,
  visibleNotifications,
  type NotificationRecord,
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
  it("links both local STUN outcomes to the STUN tool", () => {
    expect(localNotifications.stunCompleted.destination).toBe("/diagnostics/stun");
    expect(localNotifications.stunFailed.destination).toBe("/diagnostics/stun");
  });

  it("keeps source identity, reads, and native cancellation independent", () => {
    const local = receiveLocalNotification([], "selectionFailed", 1, 1);
    const mix = receiveNativeNotification(local, send("selectionFailed"), 2, 2, redact);
    expect(mix[0]).toMatchObject({
      source: "native", title: "[redacted]", subtitle: "[redacted]", body: "[redacted]",
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

  it("redacts raw reflected credentials before normalizing notification text", () => {
    const reflected = "fixture\tmarker";
    const packet = create(NotificationEventSchema, {
      event: { case: "send", value: {
        identifier: "sample",
        title: `Reflected ${reflected}`,
        subtitle: encodeURIComponent(reflected),
        body: " \x1b[31mOrdinary body\x1b[0m\tvalue ",
      } },
    });
    const [entry] = receiveNativeNotification([], packet, 1, 1, (text) =>
      text.replaceAll(reflected, "[redacted]"),
    );
    expect(entry.source).toBe("native");
    if (entry.source !== "native") throw new Error("Missing native notification");
    expect([entry.title, entry.subtitle].map((text) => text === "[redacted]")).toEqual([true, true]);
    expect(entry.body).toBe("Ordinary body value");
  });

  it("redacts a credential revealed by collapsing HTML whitespace in native text", () => {
    const token = "fixture-part fixture-marker";
    const body = "fixture-part\u00a0fixture-marker  remains separate";
    const packet = create(NotificationEventSchema, {
      event: { case: "send", value: {
        identifier: "sample",
        title: "fixture-part   fixture-marker",
        subtitle: encodeURIComponent("fixture-part\t\r\nfixture-marker"),
        body,
      } },
    });
    const [entry] = receiveNativeNotification([], packet, 1, 1, (text) =>
      text.replaceAll(token, "[redacted]"),
    );
    if (entry.source !== "native") throw new Error("Missing native notification");
    expect([entry.title, entry.subtitle].map((text) => text === "[redacted]")).toEqual([true, true]);
    expect(entry.body).toBe(body);
  });

  it("bounds memory and drops incomplete or oversized identities", () => {
    let history: NotificationRecord[] = [];
    for (let i = 0; i < NOTIFICATION_LIMIT + 5; i++) {
      history = receiveNativeNotification(history, send(`row-${i}`), i, i, redact);
    }
    expect(history).toHaveLength(NOTIFICATION_LIMIT);
    expect(history.at(-1)?.sequence).toBe(5);
    expect(receiveNativeNotification(history, send(""), 200, 200, redact)).toBe(history);
    expect(receiveNativeNotification(history, send("x".repeat(513)), 200, 200, redact)).toBe(history);
  });

  it("keeps credential-like filenames and their cancels paired through opaque history IDs", () => {
    const identifier = "taildrop/peer/password=reset.txt";
    const first = receiveNativeNotification([], send(identifier), 1, 1, redact);
    const both = receiveNativeNotification(first, send("taildrop/peer/password=other.txt"), 2, 2, redact);
    const cancel = create(NotificationEventSchema, { event: { case: "cancel", value: { identifier, typeID: 1 } } });
    const visible = visibleNotifications(receiveNativeNotification(both, cancel, 3, 3, redact));
    expect(visible).toEqual([
      expect.objectContaining({ id: "native:2", read: false }),
      expect.objectContaining({ id: "native:1", read: true, canceled: true }),
    ]);
    expect(visible[0]).not.toHaveProperty("canceled");
    expect(JSON.stringify(visible)).not.toContain("password=");
    expect(visible.every((entry) => !("nativeIdentity" in entry))).toBe(true);
  });

  it.each([
    "API replied with Bearer synthetic-value",
    "Set-Cookie: sid=synthetic-value; HttpOnly",
    '{"password":"synthetic-value"}',
    "x-api-key=synthetic-value",
    "A path //user:synthetic-value@fixture.invalid/private",
    "https%253A%252F%252Ffixture.invalid%252Fsynthetic-value",
    "Authorization%3A%20Basic%20synthetic-value",
  ])("redacts common sensitive text before storing native content", (body) => {
    const packet = create(NotificationEventSchema, {
      event: { case: "send", value: { identifier: "sample", title: "Ordinary title", body } },
    });
    expect(receiveNativeNotification([], packet, 1, 1, redact)[0]).toMatchObject({
      title: "Ordinary title", body: "[redacted]",
    });
  });
});
