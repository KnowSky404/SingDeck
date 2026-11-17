import { useDeferredValue, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X, Info } from "lucide-react";
import { useWorkspace } from "@/app/context";
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
export default function Connections() {
  const { snapshot, session, token, t } = useWorkspace();
  const [search, setSearch] = useState(""),
    [network, setNetwork] = useState("all"),
    [state, setState] = useState("active"),
    [sort, setSort] = useState("newest"),
    [page, setPage] = useState(0);
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
          const delta =
            sort === "traffic"
              ? b.downlinkTotal +
                b.uplinkTotal -
                (a.downlinkTotal + a.uplinkTotal)
              : b.createdAt - a.createdAt;
          return delta > 0n ? 1 : delta < 0n ? -1 : a.id.localeCompare(b.id);
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
  const enabled =
    snapshot.phase === "connected" &&
    !snapshot.streamErrors.connections &&
    !action.pending;
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
        {
          <Button
            variant="outline"
            disabled={!enabled || !activeCount}
            onClick={() => setConfirm(true)}
          >
            {t("Close all connections")}
          </Button>
        }
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
        <Choice
          label={t("Sort connections")}
          value={sort}
          onChange={(v) => {
            setSort(v);
            setPage(0);
          }}
          options={[
            { value: "newest", label: t("Newest first") },
            { value: "traffic", label: t("Most traffic") },
          ]}
        />
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
                  <th scope="col">{t("Upload")}</th>
                  <th scope="col">{t("Download")}</th>
                  <th scope="col">
                    <span className="sr-only">{t("Actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
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
                    <td>{bytes(c.uplinkTotal)}</td>
                    <td>{bytes(c.downlinkTotal)}</td>
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
                            void action.run(() => session.closeConnection(c.id))
                          }
                        >
                          <X />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
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
              {t(
                "This interrupts traffic on {count} tracked connections. Applications may reconnect automatically.",
                { count: activeCount },
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
              disabled={!enabled}
              onClick={() =>
                void action
                  .run(() => session.closeAllConnections())
                  .then((ok) => {
                    if (ok) setConfirm(false);
                  })
              }
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
