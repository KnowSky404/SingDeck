import { useState, useDeferredValue } from "react";
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
  CardDescription,
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

const previewLimit = 10;

function LatencyDetails({
  items,
  selected,
}: {
  items: GroupItem[];
  selected: string;
}) {
  const { t } = useWorkspace();
  return items.length ? (
    <ul className="grid gap-2">
      {items.map((item) => (
        <li key={item.tag} className="flex items-start justify-between gap-3">
          <span className="min-w-0 wrap-anywhere">
            {item.tag === selected
              ? t("Selected: {name}", { name: item.tag })
              : item.tag}
          </span>
          <Badge
            variant="outline"
            className="proxy-latency"
            data-latency={latencyTone(item)}
          >
            {t(latency(item))}
          </Badge>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-muted-foreground">
      {t("No outbounds match your filters.")}
    </p>
  );
}

function LatencyPreview({
  items,
  selected,
}: {
  items: GroupItem[];
  selected: string;
}) {
  const { t } = useWorkspace();
  const selectedIndex = items.findIndex((item) => item.tag === selected);
  const preview =
    selectedIndex >= previewLimit
      ? [...items.slice(0, previewLimit - 1), items[selectedIndex]]
      : items.slice(0, previewLimit);
  return items.length ? (
    <ul
      className="proxy-preview"
      role="list"
      aria-label={t("Node latency preview")}
    >
      {preview.map((item) => {
        const label = `${item.tag} · ${t(latency(item))}`;
        return (
          <li
            key={item.tag}
            className="proxy-dot"
            data-latency={latencyTone(item)}
            data-selected={item.tag === selected || undefined}
            title={label}
          >
            <span className="sr-only">
              {item.tag === selected ? `${label} · ${t("Selected")}` : label}
            </span>
          </li>
        );
      })}
      {items.length > previewLimit && (
        <li>
          <span aria-hidden="true">+{items.length - previewLimit}</span>
          <span className="sr-only">
            {t("{count} more outbounds", {
              count: items.length - previewLimit,
            })}
          </span>
        </li>
      )}
    </ul>
  ) : (
    <p className="proxy-preview">{t("No outbounds match your filters.")}</p>
  );
}

function ProxyGroup({
  group,
  search,
  type,
  view,
}: {
  group: Group;
  search: string;
  type: string;
  view: string;
}) {
  const { snapshot, session, t } = useWorkspace();
  const selection = useAction(),
    testing = useAction();
  const [target, setTarget] = useState("");
  const [expanded, setExpanded] = useState(true);
  const enabled =
    snapshot.phase === "connected" &&
    snapshot.service?.status === ServiceStatus_Type.STARTED &&
    !snapshot.streamErrors.groups;
  const items = group.items.filter(
    (item) =>
      item.tag.toLowerCase().includes(search) &&
      (type === "all" || item.type === type),
  );
  const selected = t("Selected: {name}", { name: group.selected || "—" });
  const details = `${group.type} · ${t("{count} outbounds", { count: group.items.length })}${group.selectable ? "" : ` · ${t("Read only")}`}`;
  const detailsLabel = t("Node details for {name}", { name: group.tag });
  const cards = view === "cards";
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Card className="proxy-group-card">
        <CardHeader>
          <CardTitle className="min-w-0">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="group-title-trigger"
                aria-label={t(expanded ? "Collapse {name}" : "Expand {name}", {
                  name: group.tag,
                })}
              >
                <ChevronDown data-icon="inline-start" />
                <span title={group.tag}>{group.tag}</span>
              </Button>
            </CollapsibleTrigger>
          </CardTitle>
          <CardDescription className="proxy-group-description">
            <span title={selected}>{selected}</span>
            <span title={details}>{details}</span>
          </CardDescription>
          <CardAction className="flex gap-1">
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={detailsLabel}
                  title={detailsLabel}
                >
                  <Info aria-hidden="true" />
                </Button>
              </DialogTrigger>
              <DialogContent
                closeLabel={t("Close")}
                className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
              >
                <DialogHeader>
                  <DialogTitle className="pr-8 wrap-anywhere">
                    {group.tag}
                  </DialogTitle>
                  <DialogDescription>
                    {t("Node names and latency")}
                  </DialogDescription>
                </DialogHeader>
                <LatencyDetails items={items} selected={group.selected} />
              </DialogContent>
            </Dialog>
            <Button
              variant="outline"
              size="icon"
              title={t("Test group")}
              aria-label={t("Test {name}", { name: group.tag })}
              disabled={!enabled || testing.pending}
              onClick={() => void testing.run(() => session.urlTest(group.tag))}
            >
              {testing.pending ? <LoaderCircle className="spin" /> : <Zap />}
            </Button>
          </CardAction>
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
        {!expanded && (
          <CardContent>
            <LatencyPreview items={items} selected={group.selected} />
          </CardContent>
        )}
        <CollapsibleContent>
          <CardContent>
            <div className={cards ? "proxy-items proxy-cards" : "proxy-items"}>
              {items.map((item) => {
                const active = item.tag === group.selected;
                const confirming = selection.pending && target === item.tag;
                const tone = latencyTone(item);
                const action = t(
                  confirming ? "Confirming…" : active ? "Selected" : "Select",
                );
                return (
                  <div
                    key={item.tag}
                    className={active ? "proxy-row selected" : "proxy-row"}
                    title={cards ? `${item.tag} · ${item.type}` : undefined}
                  >
                    <div className="proxy-identity">
                      <span className="proxy-mark" aria-hidden="true">
                        {confirming ? (
                          <LoaderCircle className="spin" />
                        ) : active ? (
                          <Check />
                        ) : group.selectable ? (
                          <span />
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
                      <Badge
                        variant={tone === "unknown" ? "secondary" : "outline"}
                        className="proxy-latency"
                        data-latency={tone}
                      >
                        {t(latency(item))}
                      </Badge>
                      {group.selectable && (
                        <Button
                          variant={
                            cards ? "ghost" : active ? "secondary" : "outline"
                          }
                          size="sm"
                          className={cards ? "proxy-select" : undefined}
                          aria-label={
                            cards && !confirming
                              ? t(
                                  active ? "Selected: {name}" : "Select {name}",
                                  { name: item.tag },
                                )
                              : undefined
                          }
                          disabled={!enabled || selection.pending || active}
                          onClick={() => {
                            setTarget(item.tag);
                            void selection.run(() =>
                              session.selectOutbound(group.tag, item.tag),
                            );
                          }}
                        >
                          <span className={cards ? "sr-only" : undefined}>
                            {action}
                          </span>
                        </Button>
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
    [view, setView] = useState("cards"),
    [groupView, setGroupView] = useState("cards");
  const query = useDeferredValue(search.toLowerCase());
  const groups = snapshot.groups ?? [];
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
              search={query}
              type={type}
              view={view}
            />
          ))}
        </div>
      </ChannelState>
      <p className="footnote">
        {t(
          "Selection is confirmed by the instance. “No result” can mean untested or a failed test: this API removes failed test history.",
        )}
      </p>
    </>
  );
}
