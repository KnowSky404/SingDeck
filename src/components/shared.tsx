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

export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
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
  return (
    <Alert>
      <AlertCircle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
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
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Cable />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
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
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={label} />
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
  const { snapshot } = useWorkspace();
  const error = snapshot.streamErrors[channel];
  if (snapshot.phase === "disconnected")
    return (
      <EmptyState
        title="No active connection"
        description="Connect a trusted instance in Settings or explore the clearly labeled demo."
      />
    );
  if (snapshot.phase === "error" && !snapshot.loaded[channel])
    return (
      <EmptyState
        title="Data unavailable"
        description="Correct the connection settings and retry to receive instance data."
      />
    );
  if (!snapshot.loaded[channel] && !error && snapshot.phase !== "error")
    return (
      <div
        role="status"
        aria-label="Loading live data"
        className="loading-state"
      >
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-20 w-full" />
        <span>
          <LoaderCircle className="spin" /> Waiting for the instance…
        </span>
      </div>
    );
  return (
    <>
      {error && (
        <Notice
          title={`${channel[0].toUpperCase() + channel.slice(1)} stream interrupted`}
        >
          {error} Retained data may be stale.
        </Notice>
      )}
      {empty ? (
        <EmptyState
          title="Nothing to show yet"
          description="No matching data has been received from this instance."
        />
      ) : (
        children
      )}
    </>
  );
}
