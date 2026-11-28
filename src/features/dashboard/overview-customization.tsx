import { useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useWorkspace } from "@/app/context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  defaultOverviewLayout,
  overviewMetricLabels,
  overviewPanelLabels,
  type OverviewLayout,
} from "./overview-layout";

function CardOrder<CardId extends string>({ title, order, labels, disabled, onMove }: {
  title: string;
  order: readonly CardId[];
  labels: Record<CardId, string>;
  disabled: boolean;
  onMove: (order: CardId[], label: string, position: number, button: HTMLButtonElement) => void;
}) {
  const { t } = useWorkspace();

  function move(card: CardId, from: number, to: number, button: HTMLButtonElement) {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, card);
    onMove(next, labels[card], to + 1, button);
  }

  return (
    <div className="grid gap-1">
      <h3 className="text-sm font-medium">{t(title)}</h3>
      <ol aria-label={t(title)} role="list" className="grid gap-1">
        {order.map((card, index) => (
          <li key={card} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border px-2 py-1">
            <span className="wrap-anywhere">{t(labels[card])}</span>
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("Move {card} up", { card: t(labels[card]) })}
                disabled={disabled}
                aria-disabled={index === 0}
                className="aria-disabled:opacity-50"
                onClick={(event) => move(card, index, index - 1, event.currentTarget)}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("Move {card} down", { card: t(labels[card]) })}
                disabled={disabled}
                aria-disabled={index === order.length - 1}
                className="aria-disabled:opacity-50"
                onClick={(event) => move(card, index, index + 1, event.currentTarget)}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function OverviewCustomization({ layout, onChange }: {
  layout: OverviewLayout;
  onChange: (layout: OverviewLayout) => boolean;
}) {
  const { t } = useWorkspace();
  const title = useRef<HTMLHeadingElement>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const staleNotice = t("Overview layout changed. Review it and continue editing.");
  const showStaleNotice = announcement === staleNotice;

  useLayoutEffect(() => {
    const button = showStaleNotice ? continueButton.current : actionButton.current;
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
    button?.focus({ preventScroll: true });
    if (!showStaleNotice) actionButton.current = null;
  }, [announcement, layout, showStaleNotice]);

  function change(next: OverviewLayout, success: string, button: HTMLButtonElement) {
    actionButton.current = button;
    setAnnouncement(onChange(next) ? success : staleNotice);
  }

  function move(next: OverviewLayout, label: string, position: number, count: number, button: HTMLButtonElement) {
    change(next, t("Moved {card} to position {position} of {count}.", {
      card: t(label), position, count,
    }), button);
  }

  return (
    <Dialog onOpenChange={(open) => {
      if (!open) return;
      actionButton.current = null;
      setAnnouncement("");
    }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">{t("Customize Overview")}</Button>
      </DialogTrigger>
      <DialogContent
        closeLabel={t("Close")}
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-y-auto"
        onMouseDownCapture={(event) => {
          if (showStaleNotice && event.target instanceof Element && !event.target.closest("button:not(:disabled)")) {
            event.preventDefault();
          }
        }}
        onKeyDownCapture={(event) => {
          if (event.repeat && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          title.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle ref={title} tabIndex={-1}>{t("Customize Overview")}</DialogTitle>
          <DialogDescription>
            {!showStaleNotice && t("Move cards within each group.")}
            <span role="status" className={showStaleNotice ? undefined : "sr-only"}>{announcement}</span>
          </DialogDescription>
        </DialogHeader>
        <div
          role={showStaleNotice ? "region" : undefined}
          aria-label={showStaleNotice ? t("Overview card order") : undefined}
          tabIndex={showStaleNotice ? 0 : undefined}
          className="grid min-h-12 gap-4 overflow-y-auto p-1 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <CardOrder
            title="Metric cards"
            order={layout.metrics}
            labels={overviewMetricLabels}
            disabled={showStaleNotice}
            onMove={(metrics, label, position, button) => move({ ...layout, metrics }, label, position, metrics.length, button)}
          />
          <CardOrder
            title="Detail panels"
            order={layout.panels}
            labels={overviewPanelLabels}
            disabled={showStaleNotice}
            onMove={(panels, label, position, button) => move({ ...layout, panels }, label, position, panels.length, button)}
          />
        </div>
        <div className="flex shrink-0 justify-end gap-2">
          {showStaleNotice && (
            <Button ref={continueButton} type="button" className="mr-auto" onClick={() => setAnnouncement("")}>
              {t("Continue editing")}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={showStaleNotice}
            onClick={(event) => change(defaultOverviewLayout, t("Default layout restored."), event.currentTarget)}
          >
            {t("Reset layout")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
