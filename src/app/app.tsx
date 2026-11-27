import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Gauge,
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
import { useDesktopAlerts } from "@/features/notifications/desktop";
import type { InstanceSession } from "@/api/session";

const Overview = lazy(() => import("@/features/dashboard/page"));
const RuntimeMonitor = lazy(() => import("@/features/dashboard/runtime-monitor"));
const Proxies = lazy(() => import("@/features/proxies/page"));
const Connections = lazy(() => import("@/features/connections/page"));
const Logs = lazy(() => import("@/features/logs/page"));
const Diagnostics = lazy(() => import("@/features/diagnostics/page"));
const ConfigurationHealth = lazy(() => import("@/features/diagnostics/health"));
const SettingsPage = lazy(() => import("@/features/settings/page"));
const USBIPStatus = lazy(() => import("@/features/settings/usbip"));
const Notifications = lazy(() => import("@/features/notifications/page"));
const links = [
  {
    path: "/",
    label: "Overview",
    description: "Your network, at a glance.",
    icon: House,
  },
  {
    path: "/proxies",
    label: "Outbounds",
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
    path: "/diagnostics",
    label: "Diagnostics",
    description: "Run native network quality and STUN tests.",
    icon: Gauge,
  },
  {
    path: "/settings",
    label: "Settings",
    description: "Instance and dashboard information.",
    icon: Settings,
  },
];
const currentPath = () => location.hash.slice(1) || "/";
const subscribeToastVisibility = (listener: () => void) => {
  const portals = new MutationObserver(listener);
  portals.observe(document.body, { childList: true });
  document.addEventListener("visibilitychange", listener);
  return () => {
    portals.disconnect();
    document.removeEventListener("visibilitychange", listener);
  };
};
const canDisplayToast = () =>
  !document.hidden &&
  !document.body.querySelector('[data-slot="dialog-content"], [data-slot="dropdown-menu-content"]');
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
  const { t, snapshot } = useWorkspace();
  const { networkQuality, stun } = snapshot.capabilities;
  const diagnosticsUnsupported =
    networkQuality.status === "unsupported" && stun.status === "unsupported";
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
              {t(
                href === "/diagnostics" && diagnosticsUnsupported
                  ? "This capability is unavailable on the connected instance."
                  : description,
              )}
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
  const toastRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"pending" | "shown" | "closed">("pending");
  const [fitsViewport, setFitsViewport] = useState(() => !window.visualViewport);
  const remaining = useRef(4000);
  const canShow = onProxies && visible && fitsViewport;
  if (phase === "pending" && canShow) setPhase("shown");
  else if (phase === "shown" && !onProxies) setPhase("closed");
  if (!onProxies && fitsViewport && window.visualViewport) setFitsViewport(false);
  const render = onProxies && phase !== "closed";
  const show = onProxies && phase === "shown" && visible && fitsViewport;
  useLayoutEffect(() => {
    const toast = toastRef.current;
    const viewport = window.visualViewport;
    if (!toast || !viewport) return;
    const updatePosition = () => {
      const { clientWidth, clientHeight } = document.documentElement;
      const right = clientWidth - viewport.width - viewport.offsetLeft;
      const bottom = clientHeight - viewport.height - viewport.offsetTop;
      const margin = Math.min(16, Math.max(4, viewport.width / 10 - 6));
      const topEdge = Math.floor(viewport.offsetTop + margin);
      const leftEdge = Math.floor(viewport.offsetLeft + margin);
      const bottomEdge = Math.ceil(viewport.offsetTop + viewport.height - margin);
      const rightEdge = Math.ceil(viewport.offsetLeft + viewport.width - margin);
      toast.style.setProperty("--latency-viewport-right", `${Math.max(0, right)}px`);
      toast.style.setProperty("--latency-viewport-bottom", `${Math.max(0, bottom)}px`);
      toast.style.setProperty("--latency-viewport-width", `${viewport.width}px`);
      toast.style.setProperty("--latency-toast-margin", `${margin}px`);
      toast.style.removeProperty("--latency-focus-clearance");
      toast.style.removeProperty("--latency-focus-offset");
      let bounds = toast.getBoundingClientRect();
      const focused = document.activeElement;
      const obstructions = Array.from(
        document.querySelectorAll("body > [data-radix-popper-content-wrapper]"),
        (portal) => portal.getBoundingClientRect(),
      );
      if (focused?.closest(".app-shell") && !focused.matches("main")) {
        obstructions.push(focused.getBoundingClientRect());
      }
      const gap = 8;
      const overlaps = (control: DOMRect) =>
        control.width > 0 &&
        control.height > 0 &&
        bounds.left < control.right + gap &&
        bounds.right > control.left - gap &&
        bounds.top < control.bottom + gap &&
        bounds.bottom > control.top - gap;
      let clearance = 0;
      let offset = 0;
      for (const control of obstructions) {
        if (overlaps(control)) {
          const lift = bounds.bottom - control.top + gap;
          const shift = bounds.right - control.left + gap;
          if (bounds.top - lift >= topEdge) {
            clearance += lift;
            toast.style.setProperty("--latency-focus-clearance", `${clearance}px`);
          } else if (bounds.left - shift >= leftEdge) {
            offset += shift;
            toast.style.setProperty("--latency-focus-offset", `${offset}px`);
          } else {
            setFitsViewport(false);
            return;
          }
          bounds = toast.getBoundingClientRect();
        }
      }
      setFitsViewport(
        bounds.top >= topEdge &&
          bounds.left >= leftEdge &&
          bounds.bottom <= bottomEdge &&
          bounds.right <= rightEdge &&
          !obstructions.some(overlaps),
      );
    };
    let frame = 0;
    const schedulePosition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    };
    const sizeChanges = new ResizeObserver(schedulePosition);
    sizeChanges.observe(toast);
    const observePortals = () => {
      portals.disconnect();
      portals.observe(document.body, { childList: true });
      for (const portal of document.querySelectorAll("body > [data-radix-popper-content-wrapper]")) {
        portals.observe(portal, { attributes: true, attributeFilter: ["style"] });
      }
    };
    const portals = new MutationObserver(() => {
      observePortals();
      schedulePosition();
    });
    observePortals();
    viewport.addEventListener("resize", schedulePosition);
    viewport.addEventListener("scroll", schedulePosition);
    window.addEventListener("scroll", schedulePosition);
    document.addEventListener("focusin", schedulePosition);
    document.addEventListener("focusout", schedulePosition);
    return () => {
      cancelAnimationFrame(frame);
      sizeChanges.disconnect();
      portals.disconnect();
      viewport.removeEventListener("resize", schedulePosition);
      viewport.removeEventListener("scroll", schedulePosition);
      window.removeEventListener("scroll", schedulePosition);
      document.removeEventListener("focusin", schedulePosition);
      document.removeEventListener("focusout", schedulePosition);
    };
  }, [render]);
  useLayoutEffect(() => {
    if (!show) return;
    const startedAt = performance.now();
    const timer = window.setTimeout(() => setPhase("closed"), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (performance.now() - startedAt),
      );
    };
  }, [show]);
  return render ? (
    <div
      ref={toastRef}
      className="latency-toast shadow-md"
      data-visible={show || undefined}
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
  const desktopAlerts = useDesktopAlerts(session, snapshot.notifications, t);
  const [showInventory, setShowInventory] = useState(false);
  const [reportedOutbound, setReportedOutbound] = useState<{
    session: InstanceSession;
    topologyGeneration: number;
    tag: string;
  }>();
  const subscribeHash = useCallback((listener: () => void) => {
    const onHashChange = (event: HashChangeEvent) => {
      // A quick Back can restore the hash before React renders the route that was visited.
      if (new URL(event.oldURL).hash === "#/proxies" && new URL(event.newURL).hash !== "#/proxies")
        setReportedOutbound(undefined);
      listener();
    };
    addEventListener("hashchange", onHashChange);
    return () => removeEventListener("hashchange", onHashChange);
  }, []);
  const path = useSyncExternalStore(subscribeHash, currentPath);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  const workspaceOpen = snapshot.loaded.status && !disconnecting;
  const currentReportedOutbound = path === "/proxies" && workspaceOpen &&
    !snapshot.authenticationFailed && reportedOutbound?.session === session &&
    reportedOutbound.topologyGeneration === snapshot.topologyGeneration
      ? reportedOutbound : undefined;
  if (reportedOutbound && !currentReportedOutbound) setReportedOutbound(undefined);
  const inventoryBatch = snapshot.latencyTestSource === "outbounds" &&
    !snapshot.stoppingLatencyTests;
  const inventoryEnabled = Boolean(
    workspaceOpen &&
      (path === "/diagnostics" || (path === "/proxies" && (showInventory || inventoryBatch))),
  );
  const detailChannel = inventoryEnabled
    ? "outbounds"
    : workspaceOpen && path === "/settings" && snapshot.capabilities.clashMode.status === "supported"
      ? "clashMode"
      : workspaceOpen && path === "/notifications"
        ? "notifications"
        : workspaceOpen && path === "/settings/usbip" && profile.mode === "native"
          ? "usbip"
          : "connections";
  useEffect(() => {
    session.setDetailChannel(detailChannel);
  }, [detailChannel, session]);
  const [collapsed, setCollapsed] = useState(false),
    [menu, setMenu] = useState(false);
  const pageKey = `${profile.id}:${session.profile.endpoint}`;
  const Page =
    path === "/"
      ? Overview
      : path === "/logs"
        ? Logs
        : path === "/diagnostics"
          ? Diagnostics
          : path === "/configuration-health"
            ? ConfigurationHealth
            : path === "/runtime-monitor"
              ? RuntimeMonitor
              : path === "/settings"
                ? SettingsPage
                : path === "/settings/usbip"
                  ? USBIPStatus
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
              {path === "/proxies" ? (
                <Proxies
                  key={pageKey}
                  showInventory={showInventory}
                  reportedTag={currentReportedOutbound?.tag}
                  onShowAll={() => setReportedOutbound(undefined)}
                  onInventoryChange={(enabled) => {
                    setShowInventory(enabled);
                    if (!enabled) setReportedOutbound(undefined);
                  }}
                />
              ) : path === "/connections" ? (
                <Connections key={pageKey} onInspectOutbound={(tag, topologyGeneration) => {
                  location.hash = "/proxies";
                  setShowInventory(true);
                  setReportedOutbound({ session, tag, topologyGeneration });
                }} />
              ) : path === "/notifications" ? (
                <Notifications key={pageKey} desktop={desktopAlerts} />
              ) : Page ? (
                <Page key={pageKey} />
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
