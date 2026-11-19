import {
  Cable,
  Check,
  LogOut,
  Monitor,
  Moon,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import type { ReactNode } from "react";
import { Popover } from "radix-ui";
import { useWorkspace } from "@/app/context";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Theme } from "@/features/instances/profiles";
import type { Language } from "@/lib/i18n";

const themes = {
  light: { icon: Sun, label: "Light theme" },
  dark: { icon: Moon, label: "Dark theme" },
  system: { icon: Monitor, label: "System theme" },
};

const languages = {
  en: { label: "English", glyph: "A" },
  zh: { label: "简体中文", glyph: "中" },
};

function DisplayOption({
  children,
  label,
  value,
  side,
}: {
  children: ReactNode;
  label: string;
  value: string;
  side: "top" | "bottom";
}) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <ToggleGroupItem
            aria-label={label}
            value={value}
            className="group/display-option relative aria-checked:bg-sidebar-accent aria-checked:text-sidebar-accent-foreground"
          >
            {children}
            <Check
              aria-hidden="true"
              className="invisible absolute right-1 top-1 size-2.5 group-aria-checked/display-option:visible"
            />
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent side={side} sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DisplaySettings() {
  const { t, theme, setTheme, language, setLanguage } = useWorkspace();
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
          className="z-50 grid w-44 gap-2 rounded-xl border border-border bg-popover p-2.5 text-popover-foreground shadow-md"
        >
          <div className="grid gap-1">
            <span
              aria-hidden="true"
              className="px-1 text-xs font-medium text-muted-foreground"
            >
              {t("Theme")}
            </span>
            <ToggleGroup
              type="single"
              size="lg"
              aria-label={t("Theme")}
              className="grid w-full grid-cols-3 gap-1"
              value={theme}
              onValueChange={(value) => value && setTheme(value as Theme)}
            >
              {Object.entries(themes).map(([value, { icon: Icon, label }]) => (
                <DisplayOption
                  key={value}
                  value={value}
                  label={t(label)}
                  side="top"
                >
                  <Icon aria-hidden="true" />
                </DisplayOption>
              ))}
            </ToggleGroup>
          </div>
          <div className="grid gap-1 border-t border-border pt-2">
            <span
              aria-hidden="true"
              className="px-1 text-xs font-medium text-muted-foreground"
            >
              {t("Language")}
            </span>
            <ToggleGroup
              type="single"
              size="lg"
              aria-label={t("Language")}
              className="grid w-full grid-cols-2 gap-1"
              value={language}
              onValueChange={(value) => value && setLanguage(value as Language)}
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
            </ToggleGroup>
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
  return (
    <div className="topbar-actions">
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
