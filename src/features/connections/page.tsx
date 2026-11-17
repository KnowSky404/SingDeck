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
  const { snapshot, session, token } = useWorkspace();
  const [search, setSearch] = useState(""),
    [network, setNetwork] = useState("all"),
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
    [snapshot.connections, network, outbound, sort, query],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
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
      <PageHeading
        title="Connections"
        description="See where your traffic goes, in real time."
        action={
          <Button
            variant="outline"
            disabled={!enabled || !snapshot.connections.size}
            onClick={() => setConfirm(true)}
          >
            Close all connections
          </Button>
        }
      />
      <div className="toolbar">
        <div className="search-field">
          <Search />
          <Input
            aria-label="Search connections"
            placeholder="Search destinations, sources, routes…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <Choice
          label="Network filter"
          value={network}
          onChange={(v) => {
            setNetwork(v);
            setPage(0);
          }}
          options={[
            { value: "all", label: "All networks" },
            { value: "tcp", label: "TCP" },
            { value: "udp", label: "UDP" },
          ]}
        />
        <Choice
          label="Outbound filter"
          value={outbound === null ? "all" : `outbound:${outbound}`}
          onChange={(v) => {
            setOutbound(v === "all" ? null : v.slice("outbound:".length));
            setPage(0);
          }}
          options={[
            { value: "all", label: "All outbounds" },
            ...outbounds.map((tag) => ({
              value: `outbound:${tag}`,
              label: tag || "Unknown outbound",
            })),
          ]}
        />
        <Choice
          label="Sort connections"
          value={sort}
          onChange={(v) => {
            setSort(v);
            setPage(0);
          }}
          options={[
            { value: "newest", label: "Newest first" },
            { value: "traffic", label: "Most traffic" },
          ]}
        />
      </div>
      {action.error && (
        <Notice title="Connection action failed">{action.error}</Notice>
      )}
      {snapshot.connectionOverflow && (
        <Notice title="Display limit reached">
          Only {snapshot.connections.size.toLocaleString()} active connections
          are retained. The instance’s active connection count can be higher.
        </Notice>
      )}
      <Panel
        title="Active connections"
        description={`${rows.length.toLocaleString()} matching connections · ${PAGE_SIZE} rows per page`}
      >
        <ChannelState channel="connections" empty={!rows.length}>
          <div className="connection-table-wrap">
            <table className="connection-table">
              <thead>
                <tr>
                  <th scope="col">Destination</th>
                  <th scope="col">Network</th>
                  <th scope="col">Outbound</th>
                  <th scope="col">Upload</th>
                  <th scope="col">Download</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
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
                      <span>{c.protocol || "Unknown"}</span>
                    </td>
                    <td>
                      <strong>{c.outbound || "—"}</strong>
                      <span>{c.outboundType}</span>
                    </td>
                    <td>{bytes(c.uplinkTotal)}</td>
                    <td>{bytes(c.downlinkTotal)}</td>
                    <td>
                      <div className="button-row">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Details for ${c.id}`}
                          onClick={() => setDetail(c)}
                        >
                          <Info />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Close ${c.id}`}
                          disabled={!enabled}
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
          <span>Server-confirmed active connections</span>
          <div className="button-row">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Previous page"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft />
            </Button>
            <span>
              Page {currentPage + 1} / {pages}
            </span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Next page"
              disabled={currentPage >= pages - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </Panel>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close all active connections?</DialogTitle>
            <DialogDescription>
              This interrupts traffic on {snapshot.connections.size} tracked
              connections. Applications may reconnect automatically.
            </DialogDescription>
          </DialogHeader>
          {action.error && <Notice title="Close failed">{action.error}</Notice>}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
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
              {action.pending ? "Closing…" : "Close all"}
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
        <DialogContent className="details-dialog">
          <DialogHeader>
            <DialogTitle>Connection details</DialogTitle>
            <DialogDescription>
              {selected?.domain || selected?.destination} ·{" "}
              {detail && snapshot.connections.has(detail.id)
                ? "Active"
                : "Closed"}
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
