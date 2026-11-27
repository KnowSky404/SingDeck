import { create } from "@bufbuild/protobuf";
import { afterEach, expect, it, vi } from "vitest";
import { receiveLocalNotification, receiveNativeNotification } from "@/api/notifications";
import { deliverDesktopAlerts, requestDesktopPermission } from "@/features/notifications/desktop";
import { NotificationEventSchema } from "@/proto/daemon/started_service_pb";

afterEach(() => vi.unstubAllGlobals());

it("ignores permission resolved after the active connection is replaced", async () => {
  let resolvePermission!: (permission: NotificationPermission) => void;
  const pending = new Promise<NotificationPermission>((resolve) => { resolvePermission = resolve; });
  const requestPermission = vi.fn().mockReturnValue(pending);
  vi.stubGlobal("Notification", { requestPermission });
  const original = new AbortController();
  const session = { signal: original.signal };
  const result = requestDesktopPermission(session);
  expect(requestPermission).toHaveBeenCalledOnce();
  original.abort();
  session.signal = new AbortController().signal;
  resolvePermission("granted");
  await expect(result).resolves.toBeUndefined();
  await expect(requestDesktopPermission(session)).resolves.toEqual({ permission: "granted", scope: session.signal });
});

it("delivers distinct new local alerts together without mirroring native or historical events", () => {
  const messages = vi.fn();
  vi.stubGlobal("Notification", class {
    constructor(title: string, options: NotificationOptions) { messages(title, options); }
  });
  const previous = receiveLocalNotification([], "configuration", 1, 1);
  const diagnostic = receiveLocalNotification(previous, "stunFailed", 2, 2);
  const deduped = receiveLocalNotification(diagnostic, "stunFailed", 3, 3);
  const local = receiveLocalNotification(deduped, "apiConnection", 4, 4);
  const native = create(NotificationEventSchema, {
    event: { case: "send", value: { identifier: "native-id", title: "Native payload" } },
  });
  const history = receiveNativeNotification(local, native, 5, 5, (text) => text);
  deliverDesktopAlerts(history, 1, (text) => text);
  expect(messages.mock.calls).toEqual([
    ["SingDeck", { body: "The API connection was interrupted or failed.", tag: "singdeck:apiConnection" }],
    ["SingDeck", { body: "STUN test failed.", tag: "singdeck:stunFailed" }],
  ]);
});
