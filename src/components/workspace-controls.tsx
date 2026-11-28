import {
  Bell,
  Cable,
  Check,
  LogOut,
  Monitor,
  Moon,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import type { ReactNode } from "react";
import { Popover, RadioGroup } from "radix-ui";
import { useWorkspace } from "@/app/context";
import { defaultWorkspacePages, parseDefaultWorkspacePage } from "@/app/default-workspace-page";
import { Choice } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Theme } from "@/features/instances/profiles";
import type { Language } from "@/lib/i18n";

const themes = {
  light: { icon: Sun, label: "Light theme", shortLabel: "Light" },
  dark: { icon: Moon, label: "Dark theme", shortLabel: "Dark" },
  system: { icon: Monitor, label: "System theme", shortLabel: "System" },
};

const languages = {
  en: { label: "English", glyph: "A" },
  zh: { label: "简体中文", glyph: "中" },
};

function DisplayOption({
  children,
  label,
  shortLabel = label,
  value,
  side,
}: {
  children: ReactNode;
  label: string;
  shortLabel?: string;
  value: string;
  side: "top" | "bottom";
}) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <Button
              variant="ghost"
              asChild
              className="display-option relative h-9 w-full p-1 aria-checked:bg-sidebar-accent aria-checked:text-sidebar-accent-foreground"
            >
              <RadioGroup.Item
                aria-label={label}
                value={value}
                onClick={(event) => {
                  // Radix selects on arrow focus with a programmatic click.
                  if (!event.nativeEvent.isTrusted) event.stopPropagation();
                }}
              >
                {children}
                <span
                  aria-hidden="true"
                  className="display-option-label hidden text-[10px] leading-none"
                >
                  {shortLabel}
                </span>
                <RadioGroup.Indicator asChild>
                  <Check
                    aria-hidden="true"
                    className="absolute right-1 top-1 size-2.5"
                  />
                </RadioGroup.Indicator>
              </RadioGroup.Item>
            </Button>
          </div>
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DisplaySettings() {
  const { t, theme, setTheme, language, setLanguage, defaultWorkspacePage, setDefaultWorkspacePage } = useWorkspace();
  const label = t("Display settings");

  return (
    <Popover.Root>
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <Popover.Trigger asChild>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={label}>
                <SlidersHorizontal aria-hidden="true" />
              </Button>
            </TooltipTrigger>
          </Popover.Trigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {t(themes[theme].label)} · {languages[language].label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Popover.Portal>
        <Popover.Content
          aria-label={label}
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 grid max-h-(--radix-popover-content-available-height) w-44 gap-2 overflow-y-auto rounded-xl border border-border bg-popover p-2.5 text-popover-foreground shadow-md"
        >
          <div className="grid gap-1">
            <span
              aria-hidden="true"
              className="px-1 text-xs font-medium text-muted-foreground"
            >
              {t("Theme")}
            </span>
            <RadioGroup.Root
              orientation="horizontal"
              aria-label={t("Theme")}
              className="grid w-full grid-cols-3 gap-1"
              value={theme}
              onValueChange={(value) => setTheme(value as Theme)}
            >
              {Object.entries(themes).map(
                ([value, { icon: Icon, label, shortLabel }]) => (
                  <DisplayOption
                    key={value}
                    value={value}
                    label={t(label)}
                    shortLabel={t(shortLabel)}
                    side="top"
                  >
                    <Icon aria-hidden="true" />
                  </DisplayOption>
                ),
              )}
            </RadioGroup.Root>
          </div>
          <div className="grid gap-1 border-t border-border pt-2">
            <span
              aria-hidden="true"
              className="px-1 text-xs font-medium text-muted-foreground"
            >
              {t("Language")}
            </span>
            <RadioGroup.Root
              orientation="horizontal"
              aria-label={t("Language")}
              className="grid w-full grid-cols-2 gap-1"
              value={language}
              onValueChange={(value) => setLanguage(value as Language)}
            >
              {Object.entries(languages).map(([value, { glyph, label }]) => (
                <DisplayOption
                  key={value}
                  value={value}
                  label={label}
                  side="bottom"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-4 place-items-center rounded border border-current text-[10px] leading-none font-semibold"
                  >
                    {glyph}
                  </span>
                </DisplayOption>
              ))}
            </RadioGroup.Root>
          </div>
          <div className="grid gap-1 border-t border-border pt-2">
            <span aria-hidden="true" className="px-1 text-xs font-medium text-muted-foreground">
              {t("Default workspace page")}
            </span>
            <Choice
              label="Default workspace page"
              value={defaultWorkspacePage}
              onChange={(value) => setDefaultWorkspacePage(parseDefaultWorkspacePage(value))}
              options={defaultWorkspacePages.map(({ value, label }) => ({ value, label: t(label) }))}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function WorkspaceControls({
  connection = false,
}: {
  connection?: boolean;
}) {
  const { t, profile, snapshot, connect, disconnect } = useWorkspace();
  const unread = snapshot.notifications.filter((entry) => !entry.read).length;
  const notificationsLabel = unread ? t("Notifications ({count} unread)", { count: unread }) : t("Notifications");
  return (
    <div className="topbar-actions">
      {connection && (
        <Button variant="ghost" size="icon" asChild>
          <a href="#/notifications" className="relative" aria-label={notificationsLabel} title={notificationsLabel}>
            <Bell aria-hidden="true" />
            {unread > 0 && (
              <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-destructive px-0.5 text-center text-[10px] leading-4 text-destructive-foreground">
                {unread}
              </span>
            )}
          </a>
        </Button>
      )}
      <DisplaySettings />
      {connection && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Current connection")}
              title={t("Current connection")}
            >
              <Cable />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="connection-menu">
            <DropdownMenuLabel>{t("Current connection")}</DropdownMenuLabel>
            <div className="connection-summary">
              <strong>
                {profile.mode === "mock"
                  ? t("Demo workspace")
                  : profile.endpoint}
              </strong>
              <span>
                {t(
                  {
                    disconnected: "Disconnected",
                    connecting: "Connecting",
                    connected: "Connected",
                    reconnecting: "Reconnecting",
                    error: "Connection failed",
                  }[snapshot.phase],
                )}
              </span>
              <span>
                sing-box {snapshot.version?.version ?? "—"} · API{" "}
                {snapshot.version?.apiVersion ?? "—"}
              </span>
              {profile.mode === "mock" && (
                <span>{t("No server is contacted.")}</span>
              )}
            </div>
            <DropdownMenuSeparator />
            {snapshot.phase !== "connected" && (
              <DropdownMenuItem onSelect={connect}>
                <Cable />
                {t("Retry")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={disconnect}>
              <LogOut />
              {t("Disconnect")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
