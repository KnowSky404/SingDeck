import { useEffect, useRef, useState } from "react";
import type { InstanceSession } from "@/api/session";
import { localNotifications, type NotificationEntry } from "@/api/notifications";
import type { Translate } from "@/lib/i18n";

export async function requestDesktopPermission(session: Pick<InstanceSession, "signal">) {
  const scope = session.signal;
  if (!scope || scope.aborted) return;
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    permission = "denied";
  }
  if (!scope.aborted && session.signal === scope) return { permission, scope };
}

export function deliverDesktopAlerts(history: NotificationEntry[], after: number, t: Translate) {
  for (const entry of history) {
    if (entry.sequence <= after) break;
    if (entry.source !== "local") continue;
    try {
      new Notification("SingDeck", { body: t(localNotifications[entry.kind].title), tag: `singdeck:${entry.kind}` });
    } catch {
      // Some browsers expose permission but only support service worker notifications.
    }
  }
}

export function useDesktopAlerts(session: InstanceSession, history: NotificationEntry[], t: Translate) {
  const [enabledScope, setEnabledScope] = useState<AbortSignal>();
  const [permission, setPermission] = useState<NotificationPermission>();
  const observed = useRef(0);
  const available = window.isSecureContext && typeof Notification === "function";
  const scope = session.signal;
  const enabled = Boolean(available && scope && !scope.aborted && enabledScope === scope);

  useEffect(() => {
    if (!enabled || scope?.aborted) return;
    const after = observed.current;
    observed.current = Math.max(after, history[0]?.sequence ?? 0);
    if (document.hidden && Notification.permission === "granted") deliverDesktopAlerts(history, after, t);
  }, [enabled, scope, history, t]);

  async function toggle() {
    if (!available) return;
    if (enabled) {
      setEnabledScope(undefined);
      return;
    }
    const result = await requestDesktopPermission(session);
    if (!result || result.scope.aborted || session.signal !== result.scope) return;
    setPermission(result.permission);
    if (result.permission === "granted") {
      observed.current = session.getSnapshot().notifications[0]?.sequence ?? 0;
      setEnabledScope(result.scope);
    }
  }

  return { available, enabled, denied: permission === "denied", toggle };
}
