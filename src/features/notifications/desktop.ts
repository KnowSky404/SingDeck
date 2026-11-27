import { useEffect, useRef, useState } from "react";
import type { InstanceSession } from "@/api/session";
import { localNotifications, type NotificationEntry } from "@/api/notifications";
import type { Translate } from "@/lib/i18n";

export function useDesktopAlerts(session: InstanceSession, history: NotificationEntry[], t: Translate) {
  const [enabledSession, setEnabledSession] = useState<InstanceSession>();
  const [permission, setPermission] = useState<NotificationPermission>();
  const observed = useRef(0);
  const available = window.isSecureContext && typeof Notification === "function";
  const enabled = available && enabledSession === session;

  useEffect(() => {
    if (!enabled) return;
    const latest = history.find((entry) => entry.source === "local" && entry.sequence > observed.current);
    if (!latest || latest.source !== "local") return;
    observed.current = latest.sequence;
    if (!document.hidden || Notification.permission !== "granted") return;
    try {
      new Notification("SingDeck", { body: t(localNotifications[latest.kind].title), tag: `singdeck:${latest.kind}` });
    } catch {
      // Some browsers expose permission but only support service worker notifications.
    }
  }, [enabled, history, t]);

  async function toggle() {
    if (!available) return;
    if (enabled) {
      setEnabledSession(undefined);
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === "granted" && !session.signal?.aborted) {
        observed.current = session.getSnapshot().notifications[0]?.sequence ?? 0;
        setEnabledSession(session);
      }
    } catch {
      setPermission("denied");
    }
  }

  return { available, enabled, denied: permission === "denied", toggle };
}
