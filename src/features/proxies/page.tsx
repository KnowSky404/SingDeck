import { useState, useDeferredValue } from "react";
import {
  Check,
  ChevronDown,
  LayoutGrid,
  List,
  Search,
  Zap,
  LockKeyhole,
  LoaderCircle,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type Group,
  ServiceStatus_Type,
} from "@/proto/daemon/started_service_pb";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { latency } from "./latency";

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
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Panel
        title={
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="group-title-trigger"
              aria-label={t(expanded ? "Collapse {name}" : "Expand {name}", {
                name: group.tag,
              })}
            >
              <ChevronDown data-icon="inline-start" />
              <span>{group.tag}</span>
            </Button>
          </CollapsibleTrigger>
        }
        description={`${group.type} · ${t("{count} outbounds", { count: group.items.length })} · ${t("Selected: {name}", { name: group.selected })}${group.selectable ? "" : ` · ${t("Read only")}`}`}
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={!enabled || testing.pending}
            onClick={() => void testing.run(() => session.urlTest(group.tag))}
          >
            {testing.pending ? (
              <LoaderCircle className="spin" data-icon="inline-start" />
            ) : (
              <Zap data-icon="inline-start" />
            )}
            {t("Test group")}
          </Button>
        }
      >
        {selection.error && (
          <Notice title={t("Selection failed")}>{t(selection.error)}</Notice>
        )}
        {testing.error && (
          <Notice title={t("Test failed")}>{t(testing.error)}</Notice>
        )}
        <CollapsibleContent>
          <div
            className={
              view === "cards" ? "proxy-items proxy-cards" : "proxy-items"
            }
          >
            {items.map((item) => (
              <div
                key={item.tag}
                className={
                  item.tag === group.selected
                    ? "proxy-row selected"
                    : "proxy-row"
                }
              >
                <div className="proxy-identity">
                  <span className="proxy-mark">
                    {item.tag === group.selected ? (
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
                    variant={
                      item.urlTestTime > 0n && item.urlTestDelay >= 0
                        ? "outline"
                        : "secondary"
                    }
                  >
                    {t(latency(item))}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon-sm"
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
                  {group.selectable && (
                    <Button
                      variant={
                        item.tag === group.selected ? "secondary" : "outline"
                      }
                      size="sm"
                      disabled={
                        !enabled ||
                        selection.pending ||
                        item.tag === group.selected
                      }
                      onClick={() => {
                        setTarget(item.tag);
                        void selection.run(() =>
                          session.selectOutbound(group.tag, item.tag),
                        );
                      }}
                    >
                      {t(
                        selection.pending && target === item.tag
                          ? "Confirming…"
                          : item.tag === group.selected
                            ? "Selected"
                            : "Select",
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {!items.length && (
            <p className="quiet-empty">
              {t("No outbounds match your filters.")}
            </p>
          )}
        </CollapsibleContent>
      </Panel>
    </Collapsible>
  );
}
export default function Proxies() {
  const { snapshot, t } = useWorkspace();
  const [search, setSearch] = useState(""),
    [type, setType] = useState("all"),
    [view, setView] = useState("list"),
    [groupView, setGroupView] = useState("list");
  const query = useDeferredValue(search.toLowerCase());
  const groups = snapshot.groups ?? [];
  const types = [...new Set(groups.flatMap((g) => g.items.map((i) => i.type)))];
  return (
    <>
      <PageHeading title={t("Proxies")} />
      <div className="toolbar">
        {
          <Badge variant="outline">
            {t("{count} groups", { count: groups.length })}
          </Badge>
        }
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
