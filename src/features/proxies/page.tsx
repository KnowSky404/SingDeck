import { useState, useDeferredValue, useId } from "react";
import {
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  LayoutGrid,
  List,
  Search,
  Zap,
  X,
  LockKeyhole,
  LoaderCircle,
} from "lucide-react";
import { useWorkspace } from "@/app/context";
import { useAction } from "@/hooks/use-action";
import { ChannelState, Choice, Notice, PageHeading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Group } from "@/proto/daemon/started_service_pb";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { latency, latencyTestWaves, latencyTone } from "./latency";
import { OutboundDetails } from "./outbound-details";
import { OutboundInventory } from "./inventory";

function ProxyGroup({
  group,
  groupsByTag,
  search,
  type,
  view,
  expanded,
  enabled,
  onOpenChange,
}: {
  group: Group;
  groupsByTag: ReadonlyMap<string, Group>;
  search: string;
  type: string;
  view: string;
  expanded: boolean;
  enabled: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { session, snapshot, t } = useWorkspace();
  const selection = useAction(),
    testing = useAction();
  const testingDisabled =
    !enabled ||
    snapshot.capabilities.urlTest.status === "unsupported" ||
    Boolean(snapshot.testingLatencies) ||
    testing.pending;
  const test = (tag: string) =>
    void testing.run(() =>
      session.testLatency(tag, latencyTestWaves(groupsByTag, tag)[0].windows),
    );
  const [target, setTarget] = useState("");
  const currentDescription = useId();
  const items = expanded
    ? group.items.filter(
        (item) =>
          item.tag.toLowerCase().includes(search) &&
          (type === "all" || item.type === type),
      )
    : undefined;
  const current = group.items.find((item) => item.tag === group.selected);
  const currentLatency =
    current && latencyTone(current) !== "unknown" ? latency(current) : null;
  const selected = t("Selected: {name}", { name: group.selected || "—" });
  const cards = view === "cards";
  return (
    <Collapsible open={expanded} onOpenChange={onOpenChange}>
      <Card className="proxy-group-card ring-0">
        <CardHeader className="proxy-group-header">
          <CardTitle className="min-w-0 flex-1">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="group-title-trigger"
                aria-label={t(expanded ? "Collapse {name}" : "Expand {name}", {
                  name: group.tag,
                })}
                aria-describedby={currentDescription}
              >
                <span className="proxy-group-copy">
                  <span className="proxy-group-name" title={group.tag}>
                    {group.tag}
                  </span>
                  {group.selected && (
                    <span className="proxy-group-current" title={selected}>
                      <Check aria-hidden="true" />
                      <span className="proxy-current-name">
                        {group.selected}
                      </span>
                      {currentLatency && (
                        <span className="proxy-current-latency">
                          {currentLatency}
                        </span>
                      )}
                    </span>
                  )}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="proxy-disclosure-icon"
                />
                <span id={currentDescription} className="sr-only">
                  {selected}
                  {currentLatency ? ` · ${t("Latency")} ${currentLatency}` : ""}
                  {group.selectable ? "" : ` · ${t("Read only")}`}
                </span>
              </Button>
            </CollapsibleTrigger>
          </CardTitle>
          {expanded && (
            <CardAction>
              <Button
                variant="ghost"
                size="icon"
                title={t("Test group")}
                aria-label={t("Test {name}", { name: group.tag })}
                disabled={testingDisabled || snapshot.testingManualLatencies?.has(group.tag)}
                onClick={() => test(group.tag)}
              >
                {testing.pending ? <LoaderCircle className="spin" /> : <Zap />}
              </Button>
            </CardAction>
          )}
        </CardHeader>
        {(selection.error || testing.error) && (
          <CardContent className="grid gap-2">
            {selection.error && (
              <Notice title={t("Selection failed")}>
                {t(selection.error)}
              </Notice>
            )}
            {testing.error && (
              <Notice title={t("Test failed")}>{t(testing.error)}</Notice>
            )}
          </CardContent>
        )}
        <CollapsibleContent className="proxy-group-body">
          {items && <CardContent>
            <div className={cards ? "proxy-items proxy-cards" : "proxy-items"}>
              {items.map((item) => {
                const active = item.tag === group.selected;
                const confirming = selection.pending && target === item.tag;
                const tone = latencyTone(item);
                const result = t(latency(item));
                const action = confirming
                  ? t("Confirming…")
                  : t(active ? "Selected: {name}" : "Select {name}", {
                      name: item.tag,
                    });
                return (
                  <div
                    key={item.tag}
                    className={active ? "proxy-row selected" : "proxy-row"}
                    title={`${item.tag} · ${item.type}`}
                  >
                    <div className="proxy-identity">
                      <span className="proxy-mark" aria-hidden="true">
                        {confirming ? (
                          <LoaderCircle className="spin" />
                        ) : active ? (
                          <Check />
                        ) : group.selectable ? (
                          <Circle />
                        ) : (
                          <LockKeyhole />
                        )}
                      </span>
                      <div>
                        <strong>{item.tag}</strong>
                        <span>{item.type}</span>
                      </div>
                    </div>
                    <div className="proxy-actions">
                      <span
                        className="proxy-latency"
                        data-latency={tone}
                        title={result}
                      >
                        {tone === "unknown" ? (
                          <>
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">{result}</span>
                          </>
                        ) : (
                          result
                        )}
                      </span>
                      {group.selectable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="proxy-select"
                          aria-label={action}
                          disabled={!enabled || selection.pending || active}
                          onClick={() => {
                            setTarget(item.tag);
                            void selection.run(() =>
                              session.selectOutbound(group.tag, item.tag),
                            );
                          }}
                        />
                      )}
                      <div className="proxy-node-actions">
                        <OutboundDetails
                          item={item}
                          referencedGroup={groupsByTag.get(item.tag)}
                          groupsByTag={groupsByTag}
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="proxy-test"
                          aria-label={t("Test {name} in {group}", {
                            name: item.tag,
                            group: group.tag,
                          })}
                          disabled={testingDisabled || snapshot.testingManualLatencies?.has(item.tag)}
                          onClick={() => test(item.tag)}
                        >
                          <Zap />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {!items.length && (
              <p className="quiet-empty">
                {t("No outbounds match your filters.")}
              </p>
            )}
          </CardContent>}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
type GroupDisclosure = {
  openGroups: ReadonlySet<string>;
  setOpenGroups: (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => void;
};

export default function Outbounds({
  showInventory,
  reportedTag,
  openGroups,
  setOpenGroups,
  onShowAll,
  onInventoryChange,
}: {
  showInventory: boolean;
  reportedTag?: string;
  onShowAll: () => void;
  onInventoryChange: (enabled: boolean) => void;
} & GroupDisclosure) {
  const { snapshot, t } = useWorkspace();
  const probe = snapshot.capabilities.urlTest;
  return (
    <>
      <PageHeading title="Outbounds" />
      <ToggleGroup
        type="single"
        variant="outline"
        aria-label={t("Outbound view")}
        className="proxy-toolbar"
        value={showInventory ? "inventory" : "groups"}
        onValueChange={(value) => {
          if (value) onInventoryChange(value === "inventory");
        }}
      >
        <ToggleGroupItem value="groups">{t("Groups")}</ToggleGroupItem>
        <ToggleGroupItem value="inventory">{t("All outbounds")}</ToggleGroupItem>
      </ToggleGroup>
      {probe.status === "unsupported" && (
        <Notice title={t("Latency testing unavailable")}>{probe.error}</Notice>
      )}
      {snapshot.latencyTestError && (
        <Notice title="Latency test status">{snapshot.latencyTestError}</Notice>
      )}
      {snapshot.stoppingLatencyTests && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("Queued tests stopped. The core may finish probes already sent.")}
        </p>
      )}
      {showInventory
        ? <OutboundInventory reportedTag={reportedTag} onShowAll={onShowAll} />
        : <OutboundGroups openGroups={openGroups} setOpenGroups={setOpenGroups} />}
    </>
  );
}

function OutboundGroups({ openGroups, setOpenGroups }: GroupDisclosure) {
  const { session, snapshot, t } = useWorkspace();
  const [search, setSearch] = useState(""),
    [type, setType] = useState("all"),
    [view, setView] = useState("list"),
    [groupView, setGroupView] = useState("cards");
  const query = useDeferredValue(search.toLowerCase());
  const [filteredDisclosure, setFilteredDisclosure] = useState(() => ({
    query,
    type,
    closedGroups: new Set<string>(),
  }));
  if (filteredDisclosure.query !== query || filteredDisclosure.type !== type) {
    setFilteredDisclosure({ query, type, closedGroups: new Set() });
  }
  const filtering = query !== "" || type !== "all";
  const groups = snapshot.groups ?? [];
  const enabled =
    snapshot.serviceActionsReady && snapshot.groups !== undefined &&
    !snapshot.streamErrors.groups;
  const groupsByTag = new Map(groups.map((group) => [group.tag, group]));
  const types = [...new Set(groups.flatMap((g) => g.items.map((i) => i.type)))];
  const isExpanded = (tag: string) =>
    filtering ? !filteredDisclosure.closedGroups.has(tag) : openGroups.has(tag);
  const allExpanded =
    groups.length > 0 && groups.every(({ tag }) => isExpanded(tag));
  const bulkAction = t(
    allExpanded ? "Collapse all groups" : "Expand all groups",
  );
  const testAllLabel = t("Test all groups");
  const testing = Boolean(snapshot.testingLatencies);
  const testingGroups = snapshot.latencyTestSource === "groups";

  function setExpanded(tags: string[], open: boolean) {
    const update = (current: ReadonlySet<string>) => {
      const exceptions = new Set(current);
      for (const tag of tags) {
        if (open === filtering) exceptions.delete(tag);
        else exceptions.add(tag);
      }
      return exceptions;
    };
    if (filtering) {
      setFilteredDisclosure((current) => ({
        ...current,
        closedGroups: update(current.closedGroups),
      }));
    } else {
      setOpenGroups(update);
    }
  }

  return (
    <>
      <div className="toolbar proxy-toolbar">
        <div className="search-field">
          <Search />
          <Input
            aria-label={t("Search outbounds")}
            placeholder={t("Search outbounds…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Choice
          label={t("Protocol filter")}
          value={type}
          onChange={setType}
          options={[
            { value: "all", label: t("All protocols") },
            ...types.map((t) => ({ value: t, label: t })),
          ]}
        />
        <div className="proxy-layout-controls">
          <div className="layout-control">
            <span>{t("Groups")}</span>
            <ToggleGroup
              type="single"
              value={groupView}
              onValueChange={(v) => v && setGroupView(v)}
              aria-label={t("Group layout")}
            >
              <ToggleGroupItem value="list" aria-label={t("Group list")}>
                <List />
              </ToggleGroupItem>
              <ToggleGroupItem value="cards" aria-label={t("Group cards")}>
                <LayoutGrid />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="layout-control">
            <span>{t("Nodes")}</span>
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(v) => v && setView(v)}
              aria-label={t("Node layout")}
            >
              <ToggleGroupItem value="list" aria-label={t("List view")}>
                <List />
              </ToggleGroupItem>
              <ToggleGroupItem value="cards" aria-label={t("Compact cards")}>
                <LayoutGrid />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <div className="button-row toolbar-actions">
          <Button
            variant="outline"
            size="icon"
            aria-label={testAllLabel}
            aria-busy={testingGroups}
            title={testAllLabel}
            disabled={
              !enabled ||
              snapshot.capabilities.urlTest.status === "unsupported" ||
              !groups.length ||
              Boolean(snapshot.testingManualLatencies) ||
              testing
            }
            onClick={() =>
              void session
                .testLatencies(latencyTestWaves(groupsByTag), groups)
                .catch(() => undefined)
            }
          >
            {testingGroups ? (
              <LoaderCircle aria-hidden="true" className="spin" />
            ) : (
              <Zap aria-hidden="true" />
            )}
          </Button>
          {testing && (
            <Button
              variant="outline"
              size="icon"
              aria-label={t("Stop queued tests")}
              title={t("Stop queued tests")}
              disabled={snapshot.stoppingLatencyTests}
              onClick={session.cancelLatencyTests}
            >
              <X aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label={bulkAction}
            title={bulkAction}
            disabled={!groups.length}
            onClick={() =>
              setExpanded(
                groups.map(({ tag }) => tag),
                !allExpanded,
              )
            }
          >
            {allExpanded ? (
              <ChevronsDownUp aria-hidden="true" />
            ) : (
              <ChevronsUpDown aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      <ChannelState channel="groups" empty={snapshot.groups?.length === 0}>
        <div
          className={
            groupView === "cards" ? "proxy-group-grid" : "feature-stack"
          }
        >
          {groups.map((group) => (
            <ProxyGroup
              key={group.tag}
              group={group}
              groupsByTag={groupsByTag}
              search={query}
              type={type}
              view={view}
              expanded={isExpanded(group.tag)}
              enabled={enabled}
              onOpenChange={(open) => setExpanded([group.tag], open)}
            />
          ))}
        </div>
      </ChannelState>
    </>
  );
}
