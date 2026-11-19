import {
  Cable,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";
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

const languages = { en: "English", zh: "简体中文" };

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
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => setTheme(value as Theme)}
          >
            {Object.entries(themes).map(([value, { label }]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {t(label)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <IconMenuTrigger
          icon={Languages}
          label={t("Language")}
          tooltip={`${t("Language")} · ${languages[language]}`}
        />
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={language}
            onValueChange={(value) => setLanguage(value as Language)}
          >
            {Object.entries(languages).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
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
