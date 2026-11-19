import {
  Cable,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useWorkspace } from "@/app/context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  light: { icon: Sun, label: "Light theme" },
  dark: { icon: Moon, label: "Dark theme" },
  system: { icon: Monitor, label: "System theme" },
};

const languages = {
  en: { label: "English", glyph: "A" },
  zh: { label: "简体中文", glyph: "中" },
};

function IconMenuTrigger({
  icon: Icon,
  label,
  tooltip,
}: {
  icon: LucideIcon;
  label: string;
  tooltip: string;
}) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={label}>
              <Icon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function IconMenuOption({
  children,
  label,
  value,
}: {
  children: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuRadioItem
            aria-label={label}
            textValue={label}
            value={value}
            className="min-h-9 pl-2 aria-checked:bg-sidebar-accent aria-checked:text-sidebar-accent-foreground"
          >
            {children}
          </DropdownMenuRadioItem>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          sideOffset={10}
          className="pointer-events-auto"
        >
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function WorkspaceControls({
  connection = false,
}: {
  connection?: boolean;
}) {
  const {
    t,
    theme,
    setTheme,
    language,
    setLanguage,
    profile,
    snapshot,
    connect,
    disconnect,
  } = useWorkspace();
  const appearance = themes[theme];
  return (
    <div className="topbar-actions">
      <DropdownMenu>
        <IconMenuTrigger
          icon={appearance.icon}
          label={t("Theme")}
          tooltip={t(appearance.label)}
        />
        <DropdownMenuContent align="end" className="w-auto min-w-0">
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => setTheme(value as Theme)}
          >
            {Object.entries(themes).map(([value, { icon: Icon, label }]) => (
              <IconMenuOption key={value} value={value} label={t(label)}>
                <Icon aria-hidden="true" />
              </IconMenuOption>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <IconMenuTrigger
          icon={Languages}
          label={t("Language")}
          tooltip={`${t("Language")} · ${languages[language].label}`}
        />
        <DropdownMenuContent align="end" className="w-auto min-w-0">
          <DropdownMenuRadioGroup
            value={language}
            onValueChange={(value) => setLanguage(value as Language)}
          >
            {Object.entries(languages).map(([value, { glyph, label }]) => (
              <IconMenuOption key={value} value={value} label={label}>
                <span
                  aria-hidden="true"
                  className="grid size-4 place-items-center rounded border border-current text-[10px] leading-none font-semibold"
                >
                  {glyph}
                </span>
              </IconMenuOption>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
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
