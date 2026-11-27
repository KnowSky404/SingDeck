import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Info,
} from "lucide-react";
import { useWorkspace } from "@/app/context";
import type { ConnectionBatchResult, ConnectionBatchSelection, InstanceSession } from "@/api/session";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { serializeConnectionExport } from "./export";
import {
  connectionMatcher,
  defaultConnectionFilters,
  hasNarrowingConnectionFilter,
  type ConnectionFilters,
} from "./filters";
import { ConnectionInspector } from "./inspector";

const PAGE_SIZE = 50;
const trafficColumns = [
  { key: "uplinkTotal", label: "Upload" },
  { key: "downlinkTotal", label: "Download" },
] as const;
const sortColumns = [{ key: "createdAt", label: "Start time" }, ...trafficColumns] as const;
const optionalColumns = [
  { key: "network", label: "Network" },
  { key: "outbound", label: "Outbound" },
  ...trafficColumns,
] as const;
type OptionalColumn = (typeof optionalColumns)[number]["key"];
const advancedTextFilters = [
  ["inbound", "Inbound"],
  ["protocol", "Protocol"],
  ["domain", "Domain"],
  ["rule", "Matched rule"],
  ["process", "Process"],
  ["user", "User"],
] as const;
type ConnectionSort = {
  column: (typeof sortColumns)[number]["key"];
  direction: "ascending" | "descending";
};
const defaultSort: ConnectionSort = { column: "createdAt", direction: "descending" };

function hasStartTime(timestamp: bigint) {
  return timestamp > 0n && timestamp <= 8_640_000_000_000_000n;
}

export default function Connections({ onInspectOutbound }: {
  onInspectOutbound: (tag: string, topologyGeneration: number) => void;
}) {
  const { snapshot, session, profile, language, t } = useWorkspace();
  const [filters, setFilters] = useState(defaultConnectionFilters);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(defaultSort);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<OptionalColumn>>(() => new Set());
  const [page, setPage] = useState(0);
  const startTimeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(language, {
        dateStyle: "short",
        timeStyle: "medium",
        hour12: false,
      }),
    [language],
  );
  function setColumnVisible(column: OptionalColumn, visible: boolean) {
    setHiddenColumns((current) => {
      const next = new Set(current);
      if (visible) next.delete(column);
      else next.add(column);
      return next;
    });
    if (!visible && sort.column === column) {
      setSort(defaultSort);
      setPage(0);
    }
  }
  const { outbound } = filters;
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
  const [detailId, setDetailId] = useState<string | null>(null),
    [confirm, setConfirm] = useState(false);
  const [batch, setBatch] = useState<{ session: InstanceSession; selection: ConnectionBatchSelection }>();
  const [batchResult, setBatchResult] = useState<{ session: InstanceSession; result: ConnectionBatchResult }>();
  const batchController = useRef<AbortController | null>(null);
  const batchTrigger = useRef<HTMLButtonElement>(null);
  const detailTrigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const action = useAction();
  useLayoutEffect(() => () => batchController.current?.abort(), [session]);
  const query = useDeferredValue(search);
  const rows = useMemo(
    () =>
      [...snapshot.connections.values()]
        .filter(connectionMatcher(filters, query))
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
    [snapshot.connections, filters, query, sort],
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
  const canExport = current && query === search && rows.length > 0;
  const batchAvailable = current && !snapshot.connectionOverflow && !snapshot.authenticationFailed;
  const canSelectBatch = batchAvailable && !action.pending && query === search &&
    hasNarrowingConnectionFilter(filters, query) && rows.some((row) => row.closedAt === 0n);
  const batchCurrent = batchAvailable && batch?.session === session &&
    batch.selection.topologyGeneration === snapshot.topologyGeneration &&
    batch.selection.connectionGeneration === snapshot.connectionGeneration;
  const result = batchResult?.session === session ? batchResult.result : undefined;

  function updateFilter<Key extends keyof ConnectionFilters>(key: Key, value: ConnectionFilters[Key]) {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setPage(0);
  }

  function confirmCloseAll() {
    void action.run(session.closeAllConnections).then((ok) => {
      if (ok) setConfirm(false);
    });
  }

  function exportConnections() {
    if (!canExport) return;
    const exportedAt = new Date();
    const report = serializeConnectionExport(
      rows,
      profile.mode,
      exportedAt,
      snapshot.connectionOverflow,
      (value) => session.redactText(value),
    );
    const url = URL.createObjectURL(new Blob([report], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `singdeck-connections-${exportedAt.getTime()}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function selectBatch() {
    if (!canSelectBatch) return;
    setBatch({
      session,
      selection: {
        ids: rows.filter((row) => row.closedAt === 0n).map((row) => row.id),
        topologyGeneration: snapshot.topologyGeneration,
        connectionGeneration: snapshot.connectionGeneration,
      },
    });
  }

  function confirmBatch() {
    if (!batchCurrent || action.pending) return;
    void action.run(async () => {
      const controller = new AbortController();
      batchController.current = controller;
      try {
        const result = await session.closeConnectionBatch(batch.selection, controller.signal);
        setBatchResult({ session, result });
      } finally {
        batchController.current = null;
        setBatch(undefined);
      }
    });
  }

  return (
    <>
      <PageHeading title={t("Connections")} />
      <div className="toolbar">
        <Choice
          label={t("Status filter")}
          value={filters.status}
          onChange={(value) => updateFilter("status", value)}
          options={[
            { value: "active", label: t("Active") },
            { value: "closed", label: t("Closed") },
            { value: "all", label: t("All statuses") },
          ]}
        />
        <div className="search-field">
          <Search />
          <Input
            ref={searchInput}
            aria-label={t("Search connections")}
            placeholder={t("Search destinations, sources, routes…")}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </div>
        <Choice
          label={t("Network filter")}
          value={filters.network}
          onChange={(value) => updateFilter("network", value)}
          options={[
            { value: "all", label: t("All networks") },
            { value: "tcp", label: t("TCP") },
            { value: "udp", label: t("UDP") },
          ]}
        />
        <Choice
          label={t("Outbound filter")}
          value={outbound === null ? "all" : `outbound:${outbound}`}
          onChange={(value) =>
            updateFilter("outbound", value === "all" ? null : value.slice("outbound:".length))
          }
          options={[
            { value: "all", label: t("All outbounds") },
            ...outbounds.map((tag) => ({
              value: `outbound:${tag}`,
              label: tag || t("Unknown outbound"),
            })),
          ]}
        />
        <div className="button-row toolbar-actions">
          <Button ref={batchTrigger} variant="outline" disabled={!canSelectBatch} onClick={selectBatch}>
            {t("Close matching connections")}
          </Button>
          <Button variant="outline" disabled={!closeAllEnabled} onClick={() => setConfirm(true)}>
            {t("Close all connections")}
          </Button>
        </div>
      </div>
      <Collapsible>
        <div className="button-row">
          <CollapsibleTrigger asChild>
            <Button variant="outline">{t("Advanced filters")}</Button>
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            onClick={() => {
              setFilters(defaultConnectionFilters);
              setSearch("");
              setPage(0);
            }}
          >
            {t("Clear filters")}
          </Button>
          <Button
            variant="outline"
            disabled={!canExport}
            title={t("Includes matching records retained by this dashboard across all pages.")}
            onClick={exportConnections}
          >
            <ArrowDownToLine aria-hidden="true" />
            {t("Export matching connections")}
          </Button>
        </div>
        <CollapsibleContent>
          <div className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field>
              <FieldLabel>{t("IP version")}</FieldLabel>
              <Choice
                label="IP version"
                value={filters.ipVersion}
                onChange={(value) => updateFilter("ipVersion", value)}
                options={[
                  { value: "all", label: t("All IP versions") },
                  { value: "4", label: "IPv4" },
                  { value: "6", label: "IPv6" },
                ]}
              />
            </Field>
            {advancedTextFilters.map(([key, label]) => (
              <Field key={key}>
                <FieldLabel htmlFor={`connections-filter-${key}`}>{t(label)}</FieldLabel>
                <Input
                  id={`connections-filter-${key}`}
                  value={filters[key]}
                  onChange={(event) => updateFilter(key, event.target.value)}
                />
              </Field>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {action.error && (
        <Notice title={t("Connection action failed")}>{t(action.error)}</Notice>
      )}
      {result && (
        <Notice title={t("Batch close result")}>
          <p>{t("Requests acknowledged {acknowledged} · Already closed {skipped} · Requests unsent {unsent}", {
            acknowledged: result.acknowledged,
            skipped: result.skipped,
            unsent: result.unsent,
          })}</p>
          {result.unacknowledged > 0 && (
            <p>{t("One attempted request had no acknowledgement.")}</p>
          )}
          {result.error && <p>{t(result.error)}</p>}
          <p>{t("The live connection list confirms which connections closed.")}</p>
        </Notice>
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
        action={(
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">{t("Columns")}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {optionalColumns.map(({ key, label }) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={!hiddenColumns.has(key)}
                    onCheckedChange={(checked) => setColumnVisible(key, checked)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {t(label)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={hiddenColumns.size === 0} onSelect={() => setHiddenColumns(new Set())}>
                  {t("Reset columns")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      >
        <ChannelState channel="connections" empty={!rows.length}>
          <div className="connection-table-wrap">
            <table className="connection-table">
              <thead>
                <tr>
                  <th scope="col">{t("Destination")}</th>
                  {!hiddenColumns.has("network") && <th scope="col">{t("Network")}</th>}
                  {!hiddenColumns.has("outbound") && <th scope="col">{t("Outbound")}</th>}
                  <th scope="col">{t("Status")}</th>
                  {sortColumns.map(({ key, label }) => {
                    if (key !== "createdAt" && hiddenColumns.has(key)) return null;
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
                      {!hiddenColumns.has("network") && (
                        <td>
                          <Badge variant="secondary">
                            {c.network.toUpperCase()}
                          </Badge>
                          <span>{c.protocol || t("Unknown")}</span>
                        </td>
                      )}
                      {!hiddenColumns.has("outbound") && (
                        <td>
                          <strong>{c.outbound || "—"}</strong>
                          <span>{c.outboundType}</span>
                        </td>
                      )}
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
                      {!hiddenColumns.has("uplinkTotal") && (
                        <td className="connection-upload">{bytes(c.uplinkTotal)}</td>
                      )}
                      {!hiddenColumns.has("downlinkTotal") && (
                        <td className="connection-download">{bytes(c.downlinkTotal)}</td>
                      )}
                      <td>
                        <div className="button-row">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("Details for {id}", { id: c.id })}
                            onClick={(event) => {
                              detailTrigger.current = event.currentTarget;
                              setDetailId(c.id);
                            }}
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
      <Dialog open={Boolean(batch)} onOpenChange={(open) => {
        if (!open && !batchController.current) setBatch(undefined);
      }}>
        <DialogContent
          closeLabel={t("Close")}
          showCloseButton={!action.pending}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (batchTrigger.current?.disabled ? searchInput.current : batchTrigger.current)?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("Close matching active connections?")}</DialogTitle>
            <DialogDescription>
              {t("This interrupts traffic on {count} active connections matching the current filters across all pages. Only this fixed set will be requested.", {
                count: batch?.selection.ids.length ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          {!batchCurrent && !action.pending && (
            <p>{t("Connection records changed. Review the current filters and try again.")}</p>
          )}
          <DialogFooter>
            {action.pending ? (
              <Button variant="outline" onClick={() => batchController.current?.abort()}>
                {t("Stop closing connections")}
              </Button>
            ) : (
              <DialogClose asChild>
                <Button variant="outline">{t("Cancel")}</Button>
              </DialogClose>
            )}
            <Button variant="destructive" disabled={!batchCurrent || action.pending} onClick={confirmBatch}>
              {t(action.pending ? "Closing…" : "Close matching connections")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConnectionInspector
        connectionId={detailId}
        onInspectOutbound={onInspectOutbound}
        onClose={() => setDetailId(null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const trigger = detailTrigger.current;
          (trigger?.isConnected ? trigger : searchInput.current)?.focus();
        }}
      />
    </>
  );
}
