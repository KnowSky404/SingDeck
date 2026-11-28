import { Info } from "lucide-react";
import type { Workspace } from "@/app/context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Group, GroupItem } from "@/proto/daemon/started_service_pb";
import { latency, latencyTone, selectedRoute, testedAt } from "./latency";

type OutboundDetailsProps = Pick<Workspace, "language" | "session" | "t"> & {
  item: GroupItem;
  referencedGroup?: Group;
  groupsByTag: ReadonlyMap<string, Group>;
};

export function OutboundDetails(props: OutboundDetailsProps) {
  const { item, referencedGroup, session, t } = props;
  const displayedTag = session.redactText(item.tag);
  const isGroup =
    Boolean(referencedGroup) ||
    item.type === "selector" ||
    item.type === "urltest";
  const label = t(
    isGroup ? "Group details for {name}" : "Node details for {name}",
    { name: displayedTag },
  );
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="proxy-outbound-details"
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
          <DialogTitle className="pr-8 wrap-anywhere">{displayedTag}</DialogTitle>
          <DialogDescription>
            {t(
              isGroup
                ? "Referenced proxy group"
                : "Server and transport settings are stored in the sing-box configuration file.",
            )}
          </DialogDescription>
        </DialogHeader>
        <OutboundFacts {...props} />
      </DialogContent>
    </Dialog>
  );
}

function OutboundFacts({
  item,
  referencedGroup,
  groupsByTag,
  language,
  session,
  t,
}: OutboundDetailsProps) {
  const measuredAt = testedAt(item);
  const route = referencedGroup && selectedRoute(referencedGroup, groupsByTag);
  return (
    <dl className="detail-list">
      <div>
        <dt>{t("Outbound type")}</dt>
        <dd>{session.redactText(referencedGroup?.type || item.type)}</dd>
      </div>
      {referencedGroup && (
        <div>
          <dt>{t("Selected member")}</dt>
          <dd>{session.redactText(referencedGroup.selected) || "—"}</dd>
        </div>
      )}
      {route && route.length > 2 && (
        <div>
          <dt>{t("Selected route")}</dt>
          <dd className="wrap-anywhere">{session.redactText(route.join(" → "))}</dd>
        </div>
      )}
      <div>
        <dt>{t("Latency")}</dt>
        <dd className="proxy-latency" data-latency={latencyTone(item)}>
          {t(latency(item))}
        </dd>
      </div>
      <div>
        <dt>{t("Last tested")}</dt>
        <dd>
          {measuredAt ? (
            <time dateTime={measuredAt.toISOString()}>
              {measuredAt.toLocaleString(language)}
            </time>
          ) : (
            "—"
          )}
        </dd>
      </div>
      {!measuredAt && (
        <div>
          <dt>{t("History")}</dt>
          <dd>{t("No history. The core does not distinguish an untested outbound from a failed test.")}</dd>
        </div>
      )}
    </dl>
  );
}
