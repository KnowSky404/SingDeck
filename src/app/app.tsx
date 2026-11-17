import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowRight,
  Cable,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  House,
  Layers3,
  Menu,
  Network,
  Radio,
  Settings,
  Terminal,
  Sun,
  Moon,
  Monitor,
  Unplug,
} from "lucide-react";
import { useWorkspace } from "./context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Choice, EmptyState, Notice } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const Overview = lazy(() => import("@/features/dashboard/page"));
const Proxies = lazy(() => import("@/features/proxies/page"));
const Connections = lazy(() => import("@/features/connections/page"));
const Logs = lazy(() => import("@/features/logs/page"));
const SettingsPage = lazy(() => import("@/features/settings/page"));
const links = [
  { path: "/", label: "Overview", icon: House },
  { path: "/proxies", label: "Proxies", icon: Layers3 },
  { path: "/connections", label: "Connections", icon: Network },
  { path: "/logs", label: "Logs", icon: Terminal },
  { path: "/settings", label: "Settings", icon: Settings },
];
const subscribeHash = (listener: () => void) => {
  addEventListener("hashchange", listener);
  return () => removeEventListener("hashchange", listener);
};
const currentPath = () => location.hash.slice(1) || "/";
const phaseLabels = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  error: "Connection failed",
};

function Navigation({
  path,
  onNavigate,
  mobile = false,
}: {
  path: string;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  return (
    <nav aria-label={mobile ? "Mobile navigation" : "Main navigation"}>
      {links.map(({ path: href, label, icon: Icon }) => (
        <a
          key={href}
          href={`#${href}`}
          onClick={onNavigate}
          aria-current={path === href ? "page" : undefined}
          title={label}
        >
          <Icon />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}
function Brand() {
  return (
    <a className="brand" href="#/" aria-label="SingDeck overview">
      <span className="brand-mark">
        <Layers3 />
      </span>
      <span>SingDeck</span>
    </a>
  );
}
export default function App() {
  const {
    profile,
    profiles,
    session,
    snapshot,
    theme,
    setTheme,
    selectProfile,
    connect,
    disconnect,
  } = useWorkspace();
  const path = useSyncExternalStore(subscribeHash, currentPath);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  const [collapsed, setCollapsed] = useState(false),
    [menu, setMenu] = useState(false);
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const Page =
    path === "/"
      ? Overview
      : path === "/proxies"
        ? Proxies
        : path === "/connections"
          ? Connections
          : path === "/logs"
            ? Logs
            : path === "/settings"
              ? SettingsPage
              : null;
  const partial = Object.entries(snapshot.streamErrors).filter(
    ([channel, error]) => channel !== "status" && error,
  );
  return (
    <div className={cn("app-shell", collapsed && "sidebar-collapsed")}>
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand />
        <Navigation path={path} />
        <div className="sidebar-bottom">
          <Separator />
          <div className="sidebar-caption">
            <Radio /> Native Service API
          </div>
          <Button
            variant="ghost"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight /> : <ChevronLeft />}
            <span>Collapse sidebar</span>
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setTheme(
                theme === "light"
                  ? "dark"
                  : theme === "dark"
                    ? "system"
                    : "light",
              )
            }
            aria-label={`Theme: ${theme}. Change theme.`}
          >
            <ThemeIcon />
            <span>{theme[0].toUpperCase() + theme.slice(1)}</span>
          </Button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu />
            </Button>
            <Brand />
          </div>
          <div className="instance-controls">
            <Choice
              label="Active instance"
              value={profile.id}
              onChange={selectProfile}
              options={[
                ...profiles.map((p) => ({ value: p.id, label: p.name })),
                { value: "demo", label: "Demo workspace" },
              ]}
            />
            <span className="connection-status" role="status">
              <span
                className={cn(
                  "status-dot",
                  snapshot.phase !== "connected" && "muted-dot",
                )}
              />
              {phaseLabels[snapshot.phase]}
            </span>
            {profile.mode === "mock" && (
              <Badge variant="secondary" className="mock-badge">
                <FlaskConical />
                Mock mode
              </Badge>
            )}
          </div>
          <div className="topbar-actions">
            {snapshot.phase === "connected" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Disconnect instance"
                onClick={disconnect}
              >
                <Unplug />
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={connect}>
                <Cable data-icon="inline-start" />
                {snapshot.phase === "disconnected" ? "Connect" : "Retry"}
              </Button>
            )}
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {snapshot.phase === "disconnected" && (
            <div className="welcome-strip">
              <span>
                <Cable />
                Connect your network.
                <small>
                  Configure a trusted instance or take a look around.
                </small>
              </span>
              <div className="button-row">
                <Button variant="outline" size="sm" asChild>
                  <a href="#/settings">Configure instance</a>
                </Button>
                <Button size="sm" onClick={() => selectProfile("demo")}>
                  Explore demo <ArrowRight data-icon="inline-end" />
                </Button>
              </div>
            </div>
          )}
          {snapshot.error && (
            <Notice
              title={
                snapshot.phase === "reconnecting"
                  ? "Reconnecting · data may be stale"
                  : "Connection failed"
              }
            >
              {snapshot.error} <a href="#/settings">Open Settings</a>
            </Notice>
          )}
          {partial.length > 0 && path === "/" && (
            <Notice title="Some live data is unavailable">
              {partial.map(([name]) => name).join(", ")} stream interrupted.
              Open the relevant page for details.
            </Notice>
          )}
          <AppErrorBoundary key={`${profile.id}:${path}`}>
            <Suspense
              fallback={
                <div
                  role="status"
                  aria-label="Loading page"
                  className="loading-state"
                >
                  <Skeleton className="h-10 w-52" />
                  <Skeleton className="h-64 w-full" />
                </div>
              }
            >
              {Page ? (
                <Page key={`${profile.id}:${session.profile.endpoint}`} />
              ) : (
                <EmptyState
                  title="Page not found"
                  description="Choose a page from the navigation to continue."
                />
              )}
            </Suspense>
          </AppErrorBoundary>
          <footer className="workspace-footer">
            <span>
              <Activity />
              Native Service API · gRPC-Web
            </span>
            <span>
              <a
                href="https://github.com/KnowSky404/SingDeck"
                target="_blank"
                rel="noreferrer"
              >
                Source
              </a>
              <span>·</span>
              <a
                href="./third-party-licenses.txt"
                target="_blank"
                rel="noreferrer"
              >
                Licenses
              </a>
              <span className="footer-version">0.1.0</span>
            </span>
          </footer>
        </main>
      </div>
      <div className="mobile-bottom">
        <Navigation path={path} mobile />
      </div>
      <Dialog open={menu} onOpenChange={setMenu}>
        <DialogContent className="navigation-dialog">
          <DialogHeader>
            <DialogTitle>SingDeck navigation</DialogTitle>
            <DialogDescription>Your network workspace</DialogDescription>
          </DialogHeader>
          <Navigation path={path} onNavigate={() => setMenu(false)} mobile />
          <Choice
            label="Mobile theme"
            value={theme}
            onChange={(v) => setTheme(v as typeof theme)}
            options={["light", "dark", "system"].map((value) => ({
              value,
              label: `${value[0].toUpperCase() + value.slice(1)} theme`,
            }))}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <EmptyState
        title="This view could not be displayed"
        description="Reload this page to recover. Your credentials have not been persisted."
      />
    ) : (
      this.props.children
    );
  }
}
