import type { ReactNode } from "react";
import { AlertCircle, Cable, LoaderCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/app/context";
import type { Channel } from "@/api/state";

export function PageHeading({ title }: { title: string }) {
  const { t } = useWorkspace();
  return <h1 className="sr-only">{t(title)}</h1>;
}
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: ReactNode;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useWorkspace();
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{typeof title === "string" ? t(title) : title}</CardTitle>
        {description && <CardDescription>{t(description)}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
export function Notice({
  children,
  title = "Connection notice",
}: {
  children: ReactNode;
  title?: string;
}) {
  const { t } = useWorkspace();
  return (
    <Alert>
      <AlertCircle />
      <AlertTitle>{t(title)}</AlertTitle>
      <AlertDescription>
        {typeof children === "string" ? t(children) : children}
      </AlertDescription>
    </Alert>
  );
}
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  const { t } = useWorkspace();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Cable />
        </EmptyMedia>
        <EmptyTitle>{t(title)}</EmptyTitle>
        <EmptyDescription>{t(description)}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}
export function Choice({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const { t } = useWorkspace();
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={t(label)}>
        <SelectValue placeholder={t(label)} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
export function ChannelState({
  channel,
  children,
  empty,
}: {
  channel: Channel;
  children: ReactNode;
  empty?: boolean;
}) {
  const { snapshot, t } = useWorkspace();
  const error = snapshot.streamErrors[channel];
  if (snapshot.phase === "disconnected")
    return (
      <EmptyState
        title={t("No active connection")}
        description={t(
          "Connect a trusted instance from the entry page or explore the demo.",
        )}
      />
    );
  if (snapshot.phase === "error" && !snapshot.loaded[channel])
    return (
      <EmptyState
        title={t("Data unavailable")}
        description={t(
          "Disconnect and correct the API address or token on the entry page, then retry.",
        )}
      />
    );
  if (!snapshot.loaded[channel] && !error && snapshot.phase !== "error")
    return (
      <div
        role="status"
        aria-label={t("Loading live data")}
        className="loading-state"
      >
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-20 w-full" />
        <span>
          <LoaderCircle className="spin" />
          {t("Waiting for the instance…")}
        </span>
      </div>
    );
  return (
    <>
      {error && (
        <Notice
          title={t("{channel} stream interrupted", {
            channel: t(
              {
                service: "Service",
                status: "Overview",
                groups: "Groups",
                outbounds: "Outbounds",
                logs: "Logs",
                connections: "Connections",
              }[channel],
            ),
          })}
        >
          {t(error)} {t("Retained data may be stale.")}
        </Notice>
      )}
      {empty ? (
        <EmptyState
          title={t("Nothing to show yet")}
          description={t(
            "No matching data has been received from this instance.",
          )}
        />
      ) : (
        children
      )}
    </>
  );
}
