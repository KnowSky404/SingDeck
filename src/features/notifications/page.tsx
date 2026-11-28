import { useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useWorkspace } from "@/app/context";
import { localNotifications } from "@/api/notifications";
import { Choice, PageHeading, Panel } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { useDesktopAlerts } from "./desktop";

const sources = { all: "All sources", native: "Native Notification", local: "SingDeck Local Notification" };
const levels = { all: "All levels", info: "Information", warning: "Warning", error: "Error" };

export default function Notifications({ desktop }: { desktop: ReturnType<typeof useDesktopAlerts> }) {
  const { snapshot, session, t, language } = useWorkspace();
  const [source, setSource] = useState("all");
  const [level, setLevel] = useState("all");
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const history = snapshot.notifications;
  const hasUnread = history.some((entry) => !entry.read);
  const format = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "short" }), [language]);
  const entries = history.filter((entry) => (source === "all" || entry.source === source) &&
    (level === "all" || (entry.source === "local" ? localNotifications[entry.kind].level : "info") === level));
  const nativeStatus = snapshot.streamErrors.notifications ?? (snapshot.loaded.notifications
    ? "Native notifications received during this visit."
    : "Waiting for a native notification…");

  function dismiss(id: string, button: HTMLButtonElement) {
    if (document.activeElement === button) {
      const row = button.closest("li");
      const neighbor = row?.nextElementSibling ?? row?.previousElementSibling;
      const nextFocus = neighbor?.querySelector<HTMLButtonElement>("[data-notification-dismiss]") ??
        historyHeading.current;
      nextFocus?.focus();
    }
    session.dismissNotification(id);
  }

  return (
    <>
      <PageHeading title="Notifications" />
      <Panel
        title={<h2 ref={historyHeading} tabIndex={-1} className="w-fit rounded-sm">{t("Notification history")}</h2>}
        description="Native capture runs while this page is open. The core has no history replay."
      >
        <p role="status" className="footnote mb-3">{t(nativeStatus)}</p>
        <div className="button-row mb-3">
          <Choice
            label={t("Notification source")}
            value={source}
            onChange={setSource}
            options={Object.entries(sources).map(([value, label]) => ({ value, label: t(label) }))}
          />
          <Choice
            label={t("Notification level")}
            value={level}
            onChange={setLevel}
            options={Object.entries(levels).map(([value, label]) => ({ value, label: t(label) }))}
          />
          <Button
            variant="outline"
            aria-disabled={!hasUnread}
            className="aria-disabled:opacity-50"
            onClick={() => {
              if (hasUnread) session.markNotificationRead(true);
            }}
          >
            {t("Mark all as read")}
          </Button>
        </div>
        {entries.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><Bell /></EmptyMedia>
              <EmptyTitle>{t("No matching notifications")}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y">
            {entries.map((entry) => {
              const local = entry.source === "local" ? localNotifications[entry.kind] : undefined;
              const canceled = entry.source === "native" && entry.canceled;
              return (
                <li key={entry.id} className="grid min-w-0 gap-2 py-3">
                  <div className="button-row text-xs text-muted-foreground">
                    <Badge variant="outline">{t(sources[entry.source])}</Badge>
                    <Badge variant="secondary">{t(levels[local?.level ?? "info"])}</Badge>
                    {canceled && <Badge variant="outline">{t("Canceled by core")}</Badge>}
                    {!entry.read && <Badge>{t("Unread")}</Badge>}
                    <time dateTime={new Date(entry.receivedAt).toISOString()}>{format.format(entry.receivedAt)}</time>
                    {entry.count > 1 && <span>{t("{count} occurrences", { count: entry.count })}</span>}
                  </div>
                  <div className="wrap-anywhere">
                    <h2 className="text-sm font-medium">
                      {entry.source === "local" ? t(localNotifications[entry.kind].title) : entry.title || t("Native Notification")}
                    </h2>
                    {entry.source === "native" && (
                      <div className="text-sm text-muted-foreground" dir="auto">
                        {entry.subtitle && <p>{entry.subtitle}</p>}
                        {entry.body && <p>{entry.body}</p>}
                      </div>
                    )}
                  </div>
                  <div className="button-row">
                    {local && (
                      <Button asChild variant="outline" size="sm">
                        <a href={`#${local.destination}`}>{t("Open related page")}</a>
                      </Button>
                    )}
                    {!canceled && (
                      <Button variant="ghost" size="sm" onClick={() => session.markNotificationRead(!entry.read, entry.id)}>
                        {t(entry.read ? "Mark as unread" : "Mark as read")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      data-notification-dismiss=""
                      onClick={(event) => dismiss(entry.id, event.currentTarget)}
                    >
                      {t("Dismiss")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel title="Desktop alerts" description="Receive SingDeck local notifications when the workspace is in the background.">
        {desktop.available && !desktop.denied ? (
          <Button variant="outline" onClick={() => void desktop.toggle()}>
            {t(desktop.enabled ? "Disable desktop alerts" : "Enable desktop alerts")}
          </Button>
        ) : (
          <p className="footnote">{t(desktop.denied ? "Desktop alerts are blocked in browser settings." : "Desktop alerts are unavailable in this browser or on this origin.")}</p>
        )}
      </Panel>
    </>
  );
}
