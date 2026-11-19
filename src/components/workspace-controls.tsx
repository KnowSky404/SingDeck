import { Cable, Languages, LogOut, Monitor, Moon, Sun } from "lucide-react";
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
import type { Theme } from "@/features/instances/profiles";
import type { Language } from "@/lib/i18n";

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
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <div className="topbar-actions">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Theme")}
            title={t("Theme")}
          >
            <ThemeIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => setTheme(value as Theme)}
          >
            <DropdownMenuRadioItem value="light">
              {t("Light theme")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              {t("Dark theme")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              {t("System theme")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Language")}
            title={t("Language")}
          >
            <Languages />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={language}
            onValueChange={(value) => setLanguage(value as Language)}
          >
            <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="zh">简体中文</DropdownMenuRadioItem>
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
