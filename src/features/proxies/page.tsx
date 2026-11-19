import { useState, useDeferredValue, useId } from "react";
import {
  Check,
  ChevronDown,
  Info,
  LayoutGrid,
  List,
  Search,
  Zap,
  LockKeyhole,
  LoaderCircle,
} from "lucide-react";
import { useWorkspace } from "@/app/context";
import { useAction } from "@/hooks/use-action";
import { ChannelState, Choice, Notice, PageHeading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type Group,
  type GroupItem,
  ServiceStatus_Type,
} from "@/proto/daemon/started_service_pb";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { latency, latencyTone } from "./latency";

function NodeDetails({ node }: { node: GroupItem }) {
  const { t } = useWorkspace();
  const label = t("Node details for {name}", { name: node.tag });
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="proxy-node-details"
          aria-label={label}
          title={label}
        >
          <Info aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent
        closeLabel={t("Close")}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="pr-8 wrap-anywhere">{node.tag}</DialogTitle>
          <DialogDescription>
            {t(
              "Server and transport settings are stored in the sing-box configuration file.",
            )}
          </DialogDescription>
        </DialogHeader>
        <NodeMeasurements node={node} />
      </DialogContent>
    </Dialog>
  );
}

function NodeMeasurements({ node }: { node: GroupItem }) {
  const { language, t } = useWorkspace();
  const measuredAt = new Date(Number(node.urlTestTime) * 1000);
  const tested = node.urlTestTime > 0n && Number.isFinite(measuredAt.valueOf());
  return (
    <dl className="detail-list">
      <div>
        <dt>{t("Outbound type")}</dt>
        <dd>{node.type}</dd>
      </div>
      <div>
        <dt>{t("Latency")}</dt>
        <dd className="proxy-latency" data-latency={latencyTone(node)}>
          {t(latency(node))}
        </dd>
      </div>
      <div>
        <dt>{t("Last tested")}</dt>
        <dd>
          {tested ? (
            <time dateTime={measuredAt.toISOString()}>
              {measuredAt.toLocaleString(language)}
            </time>
          ) : (
            "—"
          )}
        </dd>
      </div>
    </dl>
  );
}

function ProxyGroup({
  group,
  groupTags,
  search,
  type,
  view,
}: {
  group: Group;
  groupTags: ReadonlySet<string>;
  search: string;
  type: string;
  view: string;
}) {
  const { snapshot, session, t } = useWorkspace();
  const selection = useAction(),
    testing = useAction();
  const [target, setTarget] = useState("");
  const [open, setOpen] = useState(false);
  const [filteredDisclosure, setFilteredDisclosure] = useState<{
    search: string;
    type: string;
    open: boolean;
  }>();
  const filtering = search !== "" || type !== "all";
  const expanded = filtering
    ? filteredDisclosure?.search !== search ||
      filteredDisclosure.type !== type ||
      filteredDisclosure.open
    : open;
  const currentDescription = useId();
  const enabled =
    snapshot.phase === "connected" &&
    snapshot.service?.status === ServiceStatus_Type.STARTED &&
    !snapshot.streamErrors.groups;
  const items = group.items.filter(
    (item) =>
      item.tag.toLowerCase().includes(search) &&
      (type === "all" || item.type === type),
  );
  const current = group.items.find((item) => item.tag === group.selected);
  const currentLatency =
    current && latencyTone(current) !== "unknown" ? latency(current) : null;
  const selected = t("Selected: {name}", { name: group.selected || "—" });
  const cards = view === "cards";
  return (
    <Collapsible
      open={expanded}
      onOpenChange={(next) => {
        if (filtering) setFilteredDisclosure({ search, type, open: next });
        else setOpen(next);
      }}
    >
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
                disabled={!enabled || testing.pending}
                onClick={() =>
                  void testing.run(() => session.urlTest(group.tag))
                }
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
          <CardContent>
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
                        ) : group.selectable ? null : (
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
                        {item.type !== "selector" &&
                          item.type !== "urltest" &&
                          !groupTags.has(item.tag) && (
                            <NodeDetails node={item} />
                          )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="proxy-test"
                          aria-label={t("Test {name} in {group}", {
                            name: item.tag,
                            group: group.tag,
                          })}
                          disabled={!enabled || testing.pending}
                          onClick={() =>
                            void testing.run(() => session.urlTest(item.tag))
                          }
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
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
export default function Proxies() {
  const { snapshot, t } = useWorkspace();
  const [search, setSearch] = useState(""),
    [type, setType] = useState("all"),
    [view, setView] = useState("list"),
    [groupView, setGroupView] = useState("cards");
  const query = useDeferredValue(search.toLowerCase());
  const groups = snapshot.groups ?? [];
  const groupTags = new Set(groups.map((group) => group.tag));
  const types = [...new Set(groups.flatMap((g) => g.items.map((i) => i.type)))];
  return (
    <>
      <PageHeading title={t("Proxies")} />
      <div className="toolbar proxy-toolbar">
        <Badge variant="outline">
          {t("{count} groups", { count: groups.length })}
        </Badge>
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
              groupTags={groupTags}
              search={query}
              type={type}
              view={view}
            />
          ))}
        </div>
      </ChannelState>
    </>
  );
}
