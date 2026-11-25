import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Activity,
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
import { EmptyState, Notice } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { AboutDialog } from "@/components/about-dialog";
import { Brand } from "@/components/brand";
import EntryPage from "./entry";
import { WorkspaceControls } from "@/components/workspace-controls";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { version } from "../../package.json";
import { cn } from "@/lib/utils";

const Overview = lazy(() => import("@/features/dashboard/page"));
const Proxies = lazy(() => import("@/features/proxies/page"));
const Connections = lazy(() => import("@/features/connections/page"));
const Logs = lazy(() => import("@/features/logs/page"));
const SettingsPage = lazy(() => import("@/features/settings/page"));
const links = [
  {
    path: "/",
    label: "Overview",
    description: "Your network, at a glance.",
    icon: House,
  },
  {
    path: "/proxies",
    label: "Proxies",
    description: "Find your route. Keep your network moving.",
    icon: Layers3,
  },
  {
    path: "/connections",
    label: "Connections",
    description: "See where your traffic goes, in real time.",
    icon: Network,
  },
  {
    path: "/logs",
    label: "Logs",
    description: "A live view into your instance.",
    icon: Terminal,
  },
  {
    path: "/settings",
    label: "Settings",
    description: "Instance and dashboard information.",
    icon: Settings,
  },
];
const subscribeHash = (listener: () => void) => {
  addEventListener("hashchange", listener);
  return () => removeEventListener("hashchange", listener);
};
const currentPath = () => location.hash.slice(1) || "/";
const subscribeToastVisibility = (listener: () => void) => {
  const dialogs = new MutationObserver(listener);
  dialogs.observe(document.body, { childList: true });
  document.addEventListener("visibilitychange", listener);
  return () => {
    dialogs.disconnect();
    document.removeEventListener("visibilitychange", listener);
  };
};
const canDisplayToast = () =>
  !document.hidden &&
  !document.querySelector('body > [data-slot="dialog-content"]');
const subscribeVisualViewport = (listener: () => void) => {
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", listener);
  viewport?.addEventListener("scroll", listener);
  return () => {
    viewport?.removeEventListener("resize", listener);
    viewport?.removeEventListener("scroll", listener);
  };
};
const visualViewportBottomInset = () => {
  const viewport = window.visualViewport;
  return viewport
    ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    : 0;
};
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
  const { t } = useWorkspace();
  return (
    <TooltipProvider delayDuration={400}>
      <nav aria-label={t(mobile ? "Mobile navigation" : "Main navigation")}>
        {links.map(({ path: href, label, description, icon: Icon }) => (
          <Tooltip key={href}>
            <TooltipTrigger asChild>
              <a
                href={`#${href}`}
                aria-label={t(label)}
                onClick={onNavigate}
                aria-current={path === href ? "page" : undefined}
              >
                <Icon />
                <span>{t(label)}</span>
              </a>
            </TooltipTrigger>
            <TooltipContent side={mobile ? "top" : "right"}>
              {t(description)}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>
    </TooltipProvider>
  );
}
function LatencyToast({
  message,
  onProxies,
}: {
  message: string;
  onProxies: boolean;
}) {
  const visible = useSyncExternalStore(
    subscribeToastVisibility,
    canDisplayToast,
  );
  const viewportInset = useSyncExternalStore(
    subscribeVisualViewport,
    visualViewportBottomInset,
  );
  const [phase, setPhase] = useState<"pending" | "shown" | "closed">("pending");
  const remaining = useRef(4000);
  const canShow = onProxies && visible;
  if (phase === "pending" && canShow) setPhase("shown");
  else if (phase === "shown" && !onProxies) setPhase("closed");
  const show = onProxies && phase === "shown";
  useEffect(() => {
    if (!show || !visible) return;
    const startedAt = performance.now();
    const timer = window.setTimeout(() => setPhase("closed"), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (performance.now() - startedAt),
      );
    };
  }, [show, visible]);
  return show ? (
    <div
      className="latency-toast shadow-md"
      style={{ "--latency-viewport-inset": `${viewportInset}px` } as CSSProperties}
    >
      {message}
    </div>
  ) : null;
}
export default function App() {
  const {
    profile,
    session,
    snapshot,
    remembering,
    disconnecting,
    storageError,
    t,
  } = useWorkspace();
  const path = useSyncExternalStore(subscribeHash, currentPath);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  const [collapsed, setCollapsed] = useState(false),
    [menu, setMenu] = useState(false);
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
  if (disconnecting) {
    return (
      <main className="entry-main">
        <p role="status">{t("Disconnecting…")}</p>
      </main>
    );
  }
  if (!snapshot.loaded.status) return <EntryPage />;
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
        {t("Skip to content")}
      </a>
      <aside className="sidebar">
        <Brand />
        <Navigation path={path} />
        <div className="sidebar-bottom">
          <div className="sidebar-about">
            <AboutDialog />
          </div>
          <Separator />
          <div className="sidebar-caption">
            <Radio />
            {t("Native Service API")}
          </div>
          <Button
            variant="ghost"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={t(collapsed ? "Expand sidebar" : "Collapse sidebar")}
          >
            {collapsed ? <ChevronRight /> : <ChevronLeft />}
            <span>{t("Collapse sidebar")}</span>
          </Button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Open navigation")}
              onClick={() => setMenu(true)}
            >
              <Menu />
            </Button>
            <Brand />
          </div>
          <div className="workspace-status">
            <span className="connection-status" role="status">
              <span
                className={cn(
                  "status-dot",
                  snapshot.phase !== "connected" && "muted-dot",
                )}
              />
              {t(phaseLabels[snapshot.phase])}
            </span>
            {profile.mode === "mock" && (
              <Badge variant="secondary" className="mock-badge">
                <FlaskConical />
                {t("Mock mode")}
              </Badge>
            )}
          </div>
          <WorkspaceControls connection />
        </header>
        <main id="main-content" tabIndex={-1}>
          {snapshot.error && (
            <Notice
              title={
                snapshot.phase === "reconnecting"
                  ? "Reconnecting · data may be stale"
                  : "Connection failed"
              }
            >
              {t(snapshot.error)}
            </Notice>
          )}
          {remembering && (
            <p className="footnote" role="status">
              {t("Saving this connection…")}
            </p>
          )}
          {storageError && (
            <Notice title={t("Settings not persisted")}>
              {t(storageError)}
            </Notice>
          )}
          {partial.length > 0 && path === "/" && (
            <Notice title={t("Some live data is unavailable")}>
              {t(
                "Some streams were interrupted. Open the relevant page for details.",
              )}
            </Notice>
          )}
          <AppErrorBoundary key={`${profile.id}:${path}`}>
            <Suspense
              fallback={
                <div
                  role="status"
                  aria-label={t("Loading page")}
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
                  title={t("Page not found")}
                  description={t(
                    "Choose a page from the navigation to continue.",
                  )}
                />
              )}
            </Suspense>
          </AppErrorBoundary>
          <footer className="workspace-footer">
            <span>
              <Activity />
              {t("Native Service API · gRPC-Web")}
            </span>
            <span>
              <a
                href="https://github.com/KnowSky404/SingDeck"
                target="_blank"
                rel="noreferrer"
              >
                {t("Source")}
              </a>
              <span>·</span>
              <a
                href="./third-party-licenses.txt"
                target="_blank"
                rel="noreferrer"
              >
                {t("Licenses")}
              </a>
              <span className="footer-version">{version}</span>
            </span>
          </footer>
        </main>
      </div>
      <div className="mobile-bottom">
        <Navigation path={path} mobile />
      </div>
      <div className="latency-toast-viewport" role="status" aria-live="polite">
        {snapshot.latencyTestSent && (
          <LatencyToast
            onProxies={path === "/proxies"}
            message={t(
              "Test requests sent. A fresh result for each node could not be confirmed.",
            )}
          />
        )}
      </div>
      <Dialog open={menu} onOpenChange={setMenu}>
        <DialogContent closeLabel={t("Close")} className="navigation-dialog">
          <DialogHeader>
            <DialogTitle>{t("SingDeck navigation")}</DialogTitle>
            <DialogDescription>{t("Your network workspace")}</DialogDescription>
          </DialogHeader>
          <Navigation path={path} onNavigate={() => setMenu(false)} mobile />
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
        description="Reload this page to recover."
      />
    ) : (
      this.props.children
    );
  }
}
