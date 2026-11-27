import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { Check, LayoutGrid, List, Search, X, Zap } from "lucide-react";
import { useWorkspace } from "@/app/context";
import type { InstanceSession } from "@/api/session";
import { ChannelState, Choice, Notice } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAction } from "@/hooks/use-action";
import type { GroupItem } from "@/proto/daemon/started_service_pb";
import {
  captureInventoryLatencyHistory,
  confirmedInventoryLatency,
  inventoryLatencyHistory,
  latency,
  latencyTestWaves,
  latencyTone,
  testedAt,
} from "./latency";
import { OutboundDetails } from "./outbound-details";

const pageSize = 60;
const recentForMs = 5 * 60 * 1000;

function indexInventory(outbounds?: GroupItem[]) {
  const unique = new Map<string, GroupItem | undefined>();
  for (const item of outbounds ?? []) {
    unique.set(item.tag, unique.has(item.tag) ? undefined : item);
  }
  return unique;
}

type SentTest = {
  session: InstanceSession;
  topologyGeneration: number;
  item: GroupItem;
  history: ReturnType<typeof captureInventoryLatencyHistory>;
  acknowledged: boolean;
  confirmed: boolean;
};

export function OutboundInventory({ reportedTag, onShowAll }: {
  reportedTag?: string;
  onShowAll?: () => void;
}) {
  const { snapshot, session, language, t } = useWorkspace();
  const action = useAction();
  const heading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const reportRegion = useCallback((region: HTMLElement | null) => {
    if (!region) return;
    return () => {
      if (!region.contains(document.activeElement)) return;
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) searchInput.current?.focus();
      });
    };
  }, []);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>();
  const [sort, setSort] = useState("tag");
  const [view, setView] = useState("list");
  const [page, setPage] = useState(0);
  const [sent, setSent] = useState<SentTest>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const normalizedSearch = search.trim().toLowerCase();
  const query = useDeferredValue(normalizedSearch);
  const { outbounds, groups } = snapshot;
  const focused = reportedTag !== undefined;
  useEffect(() => {
    if (focused) heading.current?.focus({ preventScroll: true });
  }, [focused]);
  const groupsReady = !!groups && !snapshot.streamErrors.groups && (!focused || snapshot.loaded.groups === true);
  const displayGroups = focused && !groupsReady ? undefined : groups;
  const groupsByTag = useMemo(
    () => new Map(displayGroups?.map((group) => [group.tag, group])),
    [displayGroups],
  );
  const selectedTags = useMemo(
    () => new Set(displayGroups?.map((group) => group.selected)),
    [displayGroups],
  );
  const types = useMemo(() => {
    const reported = new Set(outbounds?.map(({ type }) => type).filter(Boolean));
    if (type) reported.add(type);
    return [...reported].sort();
  }, [outbounds, type]);
  const inventoryByTag = useMemo(() => indexInventory(outbounds), [outbounds]);
  const inventoryReady = snapshot.detailChannel === "outbounds" && snapshot.serviceActionsReady &&
    !snapshot.authenticationFailed && snapshot.loaded.outbounds && !snapshot.streamErrors.outbounds;
  const reported = reportedTag !== undefined && inventoryReady ? inventoryByTag.get(reportedTag) : undefined;
  const rows = useMemo(() => {
    if (focused) return reported ? [{ item: reported, index: 0, measuredAt: testedAt(reported) }] : [];
    const matches = (outbounds ?? [])
      .filter((item) =>
        item.tag.toLowerCase().includes(query) &&
        (type === undefined || item.type === type),
      )
      .map((item, index) => ({ item, index, measuredAt: testedAt(item) }));
    return matches.sort((a, b) => {
      if (sort === "recent") {
        const time = (b.measuredAt?.valueOf() ?? 0) - (a.measuredAt?.valueOf() ?? 0);
        if (time) return time;
      } else if (sort === "latency") {
        const first = a.measuredAt && a.item.urlTestDelay >= 0
          ? a.item.urlTestDelay : Infinity;
        const second = b.measuredAt && b.item.urlTestDelay >= 0
          ? b.item.urlTestDelay : Infinity;
        if (first !== second) return first - second;
      }
      return a.item.tag.localeCompare(b.item.tag, language);
    });
  }, [focused, reported, outbounds, query, type, sort, language]);
  const formatTime = useMemo(
    () => new Intl.DateTimeFormat(language, {
      dateStyle: "short",
      timeStyle: "medium",
    }),
    [language],
  );
  const totalPages = Math.ceil(rows.length / pageSize);
  const activePage = Math.min(page, Math.max(0, totalPages - 1));
  const pageRows = rows.slice(activePage * pageSize, (activePage + 1) * pageSize);
  const canTest =
    snapshot.serviceActionsReady && snapshot.outbounds !== undefined &&
    !snapshot.streamErrors.outbounds &&
    snapshot.capabilities.urlTest.status !== "unsupported";
  const testing = Boolean(
    snapshot.testingLatencies || snapshot.testingManualLatencies || action.pending,
  );
  const readyGroups = groupsReady ? groupsByTag : undefined;
  const canBatch = canTest && groupsReady && query === normalizedSearch;
  const eligible = useMemo(
    () => rows.filter(({ item }) =>
      inventoryByTag.get(item.tag) &&
      !groupsByTag.has(item.tag) &&
      item.type !== "selector" &&
      item.type !== "urltest",
    ),
    [inventoryByTag, groupsByTag, rows],
  );
  const tracked = sent?.session === session &&
    sent.topologyGeneration === snapshot.topologyGeneration ? sent : undefined;
  const original = tracked?.history;
  const canObserve = readyGroups !== undefined && outbounds !== undefined &&
    !snapshot.streamErrors.outbounds;
  const observed = useMemo(
    () => original && tracked && canObserve
      ? inventoryLatencyHistory(tracked.item.tag, inventoryByTag, readyGroups)
      : undefined,
    [original, tracked, canObserve, inventoryByTag, readyGroups],
  );
  const pathChanged = original && canObserve && observed?.path !== original.path;
  const resultObserved = tracked && original && !pathChanged &&
    confirmedInventoryLatency(original, canTest ? observed : undefined, tracked.confirmed);
  if (tracked && original) {
    if (pathChanged) setSent({ ...tracked, history: undefined, confirmed: false });
    else if (!tracked.confirmed && resultObserved) setSent({ ...tracked, confirmed: true });
  }
  const currentSent = tracked?.acknowledged ? tracked.item : undefined;
  const capability = snapshot.capabilities.outboundInventory;

  async function test(item: GroupItem) {
    let dispatched = false;
    const acknowledged = await action.run(() => {
      setSent(undefined);
      const topology = session.getOutboundTopology();
      const inventory = indexInventory(topology.outbounds);
      const currentGroups = new Map(topology.groups?.map((group) => [group.tag, group]));
      const isGroup = item.type === "selector" || item.type === "urltest";
      if (inventory.get(item.tag)?.type !== item.type || (isGroup && !currentGroups.has(item.tag)))
        throw new ConnectError("Outbound topology changed", Code.Canceled);
      const history = captureInventoryLatencyHistory(
        item.tag,
        inventory,
        topology.outbounds ?? [],
        topology.groups ? currentGroups : undefined,
      );
      const windows = latencyTestWaves(currentGroups, item.tag)[0].windows;
      setSent({
        session,
        topologyGeneration: topology.topologyGeneration,
        item,
        history,
        acknowledged: false,
        confirmed: false,
      });
      dispatched = true;
      return session.testLatency(item.tag, windows, "outbounds");
    });
    if (!dispatched) return;
    setSent((current) =>
      current?.session === session && current.item === item
        ? (acknowledged ? { ...current, acknowledged } : undefined)
        : current,
    );
  }

  const content = (
    <>
      {!focused && <div className="toolbar proxy-toolbar">
        <div className="search-field">
          <Search aria-hidden="true" />
          <Input
            ref={searchInput}
            aria-label={t("Search outbounds")}
            placeholder={t("Search outbounds…")}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </div>
        <Choice
          label="Protocol filter"
          value={type === undefined ? "all" : String(types.indexOf(type))}
          onChange={(value) => {
            setType(value === "all" ? undefined : types[Number(value)]);
            setPage(0);
          }}
          options={[
            { value: "all", label: t("All protocols") },
            ...types.map((value, index) => ({
              value: String(index),
              label: session.redactText(value),
            })),
          ]}
        />
        <Choice
          label="Sort outbounds"
          value={sort}
          onChange={(value) => {
            setSort(value);
            setPage(0);
          }}
          options={[
            { value: "tag", label: t("Tag A–Z") },
            { value: "latency", label: t("Lowest latency") },
            { value: "recent", label: t("Most recently tested") },
          ]}
        />
        <ToggleGroup
          type="single"
          aria-label={t("Outbound layout")}
          value={view}
          onValueChange={(value) => value && setView(value)}
        >
          <ToggleGroupItem value="list" aria-label={t("List view")}>
            <List aria-hidden="true" />
          </ToggleGroupItem>
          <ToggleGroupItem value="cards" aria-label={t("Compact cards")}>
            <LayoutGrid aria-hidden="true" />
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="button-row toolbar-actions">
          {snapshot.testingLatencies ? (
            <Button
              variant="outline"
              disabled={snapshot.stoppingLatencyTests}
              onClick={session.cancelLatencyTests}
            >
              <X aria-hidden="true" />
              {t("Stop queued tests")}
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={!canBatch || testing || !eligible.length}
              onClick={() => {
                setSent(undefined);
                void session
                  .testInventory(eligible.map(({ item }) => item.tag), outbounds ?? [])
                  .catch(() => undefined);
              }}
            >
              <Zap aria-hidden="true" />
              {t("Test matching nodes ({count})", { count: eligible.length })}
            </Button>
          )}
        </div>
      </div>}
      {action.error && <Notice title="Test failed">{session.redactText(action.error)}</Notice>}
      {currentSent && (
        <p role="status" className="text-sm text-muted-foreground">
          {t(
            resultObserved
              ? "Fresh latency observed for {name}."
              : original && snapshot.testingManualLatencies?.has(currentSent.tag)
                ? "Test requested for {name}. Waiting for new latency history."
                : "Test requested for {name}. A new result could not be confirmed.",
            { name: session.redactText(currentSent.tag) },
          )}
        </p>
      )}
      {capability.status === "unsupported" && !snapshot.loaded.outbounds ? (
        <Notice title="Outbound inventory unavailable">
          {capability.error && session.redactText(capability.error)}
        </Notice>
      ) : (
        <ChannelState channel="outbounds" empty={!focused && outbounds?.length === 0}>
          {rows.length ? (
            <ul
              aria-label={t("All outbounds")}
              className={view === "cards" ? "proxy-items proxy-cards" : "proxy-items"}
            >
              {pageRows.map(({ item, index, measuredAt }) => {
                const duplicate = !inventoryByTag.get(item.tag);
                const group = duplicate ? undefined : groupsByTag.get(item.tag);
                const selected = !duplicate && selectedTags.has(item.tag);
                const isGroup = group || item.type === "selector" || item.type === "urltest";
                const displayedTag = session.redactText(item.tag);
                return (
                  <li
                    key={duplicate ? JSON.stringify([item.tag, index]) : item.tag}
                    className={selected ? "proxy-row selected" : "proxy-row"}
                  >
                    <div className="min-w-0 py-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <strong className="wrap-anywhere text-sm">{displayedTag}</strong>
                        <span className="wrap-anywhere text-xs text-muted-foreground">
                          {session.redactText(item.type)}
                        </span>
                        {duplicate && (
                          <span className="text-xs text-muted-foreground">{t("Ambiguous tag")}</span>
                        )}
                        {selected && (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <Check className="size-3" aria-hidden="true" />
                            {t("Selected")}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="proxy-latency" data-latency={latencyTone(item)}>
                          {t(latency(item))}
                        </span>
                        {measuredAt && (
                          <>
                            <time dateTime={measuredAt.toISOString()}>{formatTime.format(measuredAt)}</time>
                            {now - measuredAt.valueOf() >= recentForMs && <span>{t("Older than 5 min")}</span>}
                          </>
                        )}
                        {group?.selected && (
                          <span className="wrap-anywhere">
                            {t("Selected: {name}", { name: session.redactText(group.selected) })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="proxy-node-actions">
                      <OutboundDetails item={item} referencedGroup={group} groupsByTag={groupsByTag} />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("Test {name}", { name: displayedTag })}
                        disabled={!canTest || testing || duplicate || (!!isGroup && !groupsReady)}
                        onClick={() => void test(item)}
                      >
                        <Zap aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (!focused || !snapshot.streamErrors.outbounds) && (
            <p className="quiet-empty" role={focused ? "status" : undefined}>
              {t(focused
                ? (inventoryReady ? "The reported outbound is unavailable." : "Waiting for the instance…")
                : "No outbounds match your filters.")}
            </p>
          )}
          {totalPages > 1 && (
            <div className="button-row mt-3 items-center">
              <Button variant="outline" size="sm" disabled={!activePage} onClick={() => setPage(activePage - 1)}>
                {t("Previous page")}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t("Page {page} / {pages}", { page: activePage + 1, pages: totalPages })}
              </span>
              <Button variant="outline" size="sm" disabled={activePage + 1 >= totalPages} onClick={() => setPage(activePage + 1)}>
                {t("Next page")}
              </Button>
            </div>
          )}
        </ChannelState>
      )}
    </>
  );
  return focused ? (
    <section ref={reportRegion} aria-labelledby="reported-outbound-heading" className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="reported-outbound-heading" ref={heading} tabIndex={-1} className="font-medium">
          {t("Reported outbound")}
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={() => {
          onShowAll?.();
          requestAnimationFrame(() => searchInput.current?.focus());
        }}>
          {t("Show all outbounds")}
        </Button>
      </div>
      {content}
    </section>
  ) : content;
}
