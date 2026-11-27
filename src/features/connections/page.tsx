import { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Info,
} from "lucide-react";
import { useWorkspace } from "@/app/context";
import { hasCurrentConnections } from "@/api/state";
import { useAction } from "@/hooks/use-action";
import {
  ChannelState,
  Choice,
  Notice,
  PageHeading,
  Panel,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { bytes } from "@/lib/format";
import type { Connection } from "@/proto/daemon/started_service_pb";

const PAGE_SIZE = 50;
const sortColumns = [
  { key: "createdAt", label: "Start time" },
  { key: "uplinkTotal", label: "Upload" },
  { key: "downlinkTotal", label: "Download" },
] as const;
type ConnectionSort = {
  column: (typeof sortColumns)[number]["key"];
  direction: "ascending" | "descending";
};

function hasStartTime(timestamp: bigint) {
  return timestamp > 0n && timestamp <= 8_640_000_000_000_000n;
}

export default function Connections() {
  const { snapshot, session, token, language, t } = useWorkspace();
  const [search, setSearch] = useState(""),
    [network, setNetwork] = useState("all"),
    [state, setState] = useState("active"),
    [sort, setSort] = useState<ConnectionSort>({
      column: "createdAt",
      direction: "descending",
    }),
    [page, setPage] = useState(0);
  const startTimeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(language, {
        dateStyle: "short",
        timeStyle: "medium",
        hour12: false,
      }),
    [language],
  );
  const [outbound, setOutbound] = useState<string | null>(null);
  const outbounds = useMemo(
    () =>
      [
        ...new Set([
          ...(outbound === null ? [] : [outbound]),
          ...[...snapshot.connections.values()].map((c) => c.outbound),
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [snapshot.connections, outbound],
  );
  const [detail, setDetail] = useState<Connection | null>(null),
    [confirm, setConfirm] = useState(false);
  const action = useAction();
  const query = useDeferredValue(search.toLowerCase());
  const rows = useMemo(
    () =>
      [...snapshot.connections.values()]
        .filter(
          (c) =>
            (state === "all" ||
              (state === "closed" ? c.closedAt > 0n : c.closedAt === 0n)) &&
            (network === "all" || c.network === network) &&
            (outbound === null || c.outbound === outbound) &&
            `${c.domain} ${c.destination} ${c.source} ${c.outbound} ${c.protocol}`
              .toLowerCase()
              .includes(query),
        )
        .sort((a, b) => {
          const missing =
            Number(hasStartTime(b.createdAt)) -
            Number(hasStartTime(a.createdAt));
          if (sort.column === "createdAt" && missing) return missing;
          if (a[sort.column] !== b[sort.column]) {
            const order = a[sort.column] < b[sort.column] ? -1 : 1;
            return sort.direction === "ascending" ? order : -order;
          }
          const newestFirst = b.createdAt - a.createdAt;
          return (
            missing ||
            (newestFirst > 0n
              ? 1
              : newestFirst < 0n
                ? -1
                : a.id.localeCompare(b.id))
          );
        }),
    [snapshot.connections, state, network, outbound, sort, query],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const activeCount = [...snapshot.connections.values()].filter(
    (c) => c.closedAt === 0n,
  ).length;
  const current = snapshot.serviceActionsReady && hasCurrentConnections(snapshot);
  const enabled = current && !action.pending;
  const closeAllEnabled = enabled && activeCount > 0;

  function confirmCloseAll() {
    void action.run(session.closeAllConnections).then((ok) => {
      if (ok) setConfirm(false);
    });
  }

  const selected = detail
    ? (snapshot.connections.get(detail.id) ?? detail)
    : null;
  const details = selected
    ? JSON.stringify(
        selected,
        (key, value: unknown) =>
          key === "$typeName"
            ? undefined
            : typeof value === "bigint"
              ? value.toString()
              : value,
        2,
      )
    : "";
  return (
    <>
      <PageHeading title={t("Connections")} />
      <div className="toolbar">
        <Choice
          label={t("Status filter")}
          value={state}
          onChange={(value) => {
            setState(value);
            setPage(0);
          }}
          options={[
            { value: "active", label: t("Active") },
            { value: "closed", label: t("Closed") },
            { value: "all", label: t("All statuses") },
          ]}
        />
        <div className="search-field">
          <Search />
          <Input
            aria-label={t("Search connections")}
            placeholder={t("Search destinations, sources, routes…")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <Choice
          label={t("Network filter")}
          value={network}
          onChange={(v) => {
            setNetwork(v);
            setPage(0);
          }}
          options={[
            { value: "all", label: t("All networks") },
            { value: "tcp", label: t("TCP") },
            { value: "udp", label: t("UDP") },
          ]}
        />
        <Choice
          label={t("Outbound filter")}
          value={outbound === null ? "all" : `outbound:${outbound}`}
          onChange={(v) => {
            setOutbound(v === "all" ? null : v.slice("outbound:".length));
            setPage(0);
          }}
          options={[
            { value: "all", label: t("All outbounds") },
            ...outbounds.map((tag) => ({
              value: `outbound:${tag}`,
              label: tag || t("Unknown outbound"),
            })),
          ]}
        />
        <Button
          variant="outline"
          className="toolbar-actions"
          disabled={!closeAllEnabled}
          onClick={() => setConfirm(true)}
        >
          {t("Close all connections")}
        </Button>
      </div>
      {action.error && (
        <Notice title={t("Connection action failed")}>{t(action.error)}</Notice>
      )}
      {snapshot.connectionOverflow && (
        <Notice title={t("Display limit reached")}>
          {t(
            "Only {count} connection records are retained. The instance may have more records.",
            { count: snapshot.connections.size.toLocaleString() },
          )}
        </Notice>
      )}
      <Panel
        title={t("Connection records")}
        description={t("{count} matching connections · {size} rows per page", {
          count: rows.length.toLocaleString(),
          size: PAGE_SIZE,
        })}
      >
        <ChannelState channel="connections" empty={!rows.length}>
          <div className="connection-table-wrap">
            <table className="connection-table">
              <thead>
                <tr>
                  <th scope="col">{t("Destination")}</th>
                  <th scope="col">{t("Network")}</th>
                  <th scope="col">{t("Outbound")}</th>
                  <th scope="col">{t("Status")}</th>
                  {sortColumns.map(({ key, label }) => {
                    const direction =
                      sort.column === key ? sort.direction : undefined;
                    const Icon =
                      direction === "ascending"
                        ? ArrowUp
                        : direction === "descending"
                          ? ArrowDown
                          : ArrowUpDown;
                    return (
                      <th
                        key={key}
                        scope="col"
                        className="connection-sort"
                        aria-sort={direction}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto min-h-7 whitespace-normal text-inherit"
                          onClick={() => {
                            setSort({
                              column: key,
                              direction:
                                direction === "descending"
                                  ? "ascending"
                                  : "descending",
                            });
                            setPage(0);
                          }}
                        >
                          {t(label)}
                          <Icon aria-hidden="true" />
                        </Button>
                      </th>
                    );
                  })}
                  <th scope="col">
                    <span className="sr-only">{t("Actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const started = hasStartTime(c.createdAt)
                    ? new Date(Number(c.createdAt))
                    : null;
                  return (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.domain || c.destination}</strong>
                        <span>{c.domain ? c.destination : c.source}</span>
                      </td>
                      <td>
                        <Badge variant="secondary">
                          {c.network.toUpperCase()}
                        </Badge>
                        <span>{c.protocol || t("Unknown")}</span>
                      </td>
                      <td>
                        <strong>{c.outbound || "—"}</strong>
                        <span>{c.outboundType}</span>
                      </td>
                      <td>
                        <Badge
                          variant={c.closedAt > 0n ? "secondary" : "outline"}
                        >
                          {t(c.closedAt > 0n ? "Closed" : "Active")}
                        </Badge>
                      </td>
                      <td className="connection-time">
                        {started ? (
                          <time dateTime={started.toISOString()}>
                            {startTimeFormat.format(started)}
                          </time>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="connection-upload">
                        {bytes(c.uplinkTotal)}
                      </td>
                      <td className="connection-download">
                        {bytes(c.downlinkTotal)}
                      </td>
                      <td>
                        <div className="button-row">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("Details for {id}", { id: c.id })}
                            onClick={() => setDetail(c)}
                          >
                            <Info />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("Close {id}", { id: c.id })}
                            disabled={!enabled || c.closedAt > 0n}
                            onClick={() =>
                              void action.run(() =>
                                session.closeConnection(c.id),
                              )
                            }
                          >
                            <X />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChannelState>
        <div className="panel-footer">
          <span>{t("Server-reported connection state")}</span>
          <div className="button-row">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t("Previous page")}
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft />
            </Button>
            <span>
              {t("Page {page} / {pages}", { page: currentPage + 1, pages })}
            </span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t("Next page")}
              disabled={currentPage >= pages - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </Panel>
      <p className="footnote">
        {t(
          "The API reports Active and Closed; it does not report a separate Blocked state.",
        )}
      </p>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent closeLabel={t("Close")}>
          <DialogHeader>
            <DialogTitle>{t("Close all active connections?")}</DialogTitle>
            <DialogDescription>
              {current
                ? t(
                    "This interrupts traffic on {count} tracked connections. Applications may reconnect automatically.",
                    { count: activeCount },
                  )
                : t(
                    snapshot.streamErrors.connections ??
                      snapshot.error ??
                      "Waiting for the instance…",
                  )}
            </DialogDescription>
          </DialogHeader>
          {action.error && (
            <Notice title={t("Close failed")}>{t(action.error)}</Notice>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("Cancel")}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={!closeAllEnabled}
              onClick={confirmCloseAll}
            >
              {t(action.pending ? "Closing…" : "Close all")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent closeLabel={t("Close")} className="details-dialog">
          <DialogHeader>
            <DialogTitle>{t("Connection details")}</DialogTitle>
            <DialogDescription>
              {selected?.domain || selected?.destination} ·{" "}
              {t(selected?.closedAt === 0n ? "Active" : "Closed")}
            </DialogDescription>
          </DialogHeader>
          <pre className="connection-json">
            {token ? details.split(token).join("[redacted]") : details}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
