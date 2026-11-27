import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Check, LayoutGrid, List, Search, X, Zap } from "lucide-react";
import { useWorkspace } from "@/app/context";
import type { InstanceSession } from "@/api/session";
import { ChannelState, Choice, Notice } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAction } from "@/hooks/use-action";
import {
  type GroupItem,
  ServiceStatus_Type,
} from "@/proto/daemon/started_service_pb";
import { latency, latencyTestWaves, latencyTone, testedAt } from "./latency";
import { OutboundDetails } from "./outbound-details";

const pageSize = 60;
const recentForMs = 5 * 60 * 1000;

type SentTest = {
  session: InstanceSession;
  item: GroupItem;
};

export function OutboundInventory() {
  const { snapshot, session, language, t } = useWorkspace();
  const action = useAction();
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
  const groupsByTag = useMemo(
    () => new Map(groups?.map((group) => [group.tag, group])),
    [groups],
  );
  const selectedTags = useMemo(
    () => new Set(groups?.map((group) => group.selected)),
    [groups],
  );
  const types = useMemo(() => {
    const reported = new Set(outbounds?.map(({ type }) => type).filter(Boolean));
    if (type) reported.add(type);
    return [...reported].sort();
  }, [outbounds, type]);
  const duplicateTags = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const { tag } of outbounds ?? []) {
      if (seen.has(tag)) duplicates.add(tag);
      seen.add(tag);
    }
    return duplicates;
  }, [outbounds]);
  const rows = useMemo(() => {
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
  }, [outbounds, query, type, sort, language]);
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
    snapshot.phase === "connected" &&
    snapshot.service?.status === ServiceStatus_Type.STARTED &&
    !snapshot.streamErrors.service &&
    !snapshot.streamErrors.outbounds &&
    snapshot.capabilities.urlTest.status !== "unsupported";
  const testing = Boolean(
    snapshot.testingLatencies || snapshot.testingManualLatency || action.pending,
  );
  const groupsReady = !!groups && !snapshot.streamErrors.groups;
  const canBatch = canTest && groupsReady && query === normalizedSearch;
  const eligible = useMemo(
    () => rows.filter(({ item }) =>
      !duplicateTags.has(item.tag) &&
      !groupsByTag.has(item.tag) &&
      item.type !== "selector" &&
      item.type !== "urltest",
    ),
    [duplicateTags, groupsByTag, rows],
  );
  const currentSent = sent?.session === session ? sent.item : undefined;
  const sentResult = currentSent && outbounds?.find(({ tag }) => tag === currentSent.tag);
  const resultObserved =
    currentSent && sentResult &&
    sentResult.urlTestTime > currentSent.urlTestTime &&
    sentResult.urlTestDelay >= 0 && testedAt(sentResult);
  const capability = snapshot.capabilities.outboundInventory;

  async function test(item: GroupItem) {
    setSent(undefined);
    const windows = latencyTestWaves(groupsByTag, item.tag)[0].windows;
    const acknowledged = await action.run(() =>
      session.testLatency(item.tag, windows, "outbounds"),
    );
    if (acknowledged) setSent({ session, item });
  }

  return (
    <>
      <div className="toolbar proxy-toolbar">
        <div className="search-field">
          <Search aria-hidden="true" />
          <Input
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
      </div>
      {action.error && <Notice title="Test failed">{session.redactText(action.error)}</Notice>}
      {currentSent && (
        <p role="status" className="text-sm text-muted-foreground">
          {t(
            resultObserved
              ? "Fresh latency observed for {name}."
              : snapshot.testingManualLatency
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
        <ChannelState channel="outbounds" empty={outbounds?.length === 0}>
          {rows.length ? (
            <ul
              aria-label={t("All outbounds")}
              className={view === "cards" ? "proxy-items proxy-cards" : "proxy-items"}
            >
              {pageRows.map(({ item, index, measuredAt }) => {
                const duplicate = duplicateTags.has(item.tag);
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
          ) : (
            <p className="quiet-empty">{t("No outbounds match your filters.")}</p>
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
}
