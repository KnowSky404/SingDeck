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

function CardOrder<CardId extends string>({ title, order, labels, onMove }: {
  title: string;
  order: readonly CardId[];
  labels: Record<CardId, string>;
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
  onChange: (layout: OverviewLayout) => void;
}) {
  const { t } = useWorkspace();
  const title = useRef<HTMLHeadingElement>(null);
  const movedButton = useRef<HTMLButtonElement>(null);
  const [announcement, setAnnouncement] = useState("");

  useLayoutEffect(() => {
    movedButton.current?.focus();
    movedButton.current = null;
  }, [layout]);

  function move(next: OverviewLayout, label: string, position: number, count: number, button: HTMLButtonElement) {
    movedButton.current = button;
    onChange(next);
    setAnnouncement(t("Moved {card} to position {position} of {count}.", {
      card: t(label), position, count,
    }));
  }

  return (
    <Dialog onOpenChange={(open) => { if (open) setAnnouncement(""); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">{t("Customize Overview")}</Button>
      </DialogTrigger>
      <DialogContent
        closeLabel={t("Close")}
        className="flex max-h-[calc(100dvh-2rem)] flex-col"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          title.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle ref={title} tabIndex={-1}>{t("Customize Overview")}</DialogTitle>
          <DialogDescription>{t("Move cards within each group.")}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-y-auto p-1">
          <CardOrder
            title="Metric cards"
            order={layout.metrics}
            labels={overviewMetricLabels}
            onMove={(metrics, label, position, button) => move({ ...layout, metrics }, label, position, metrics.length, button)}
          />
          <CardOrder
            title="Detail panels"
            order={layout.panels}
            labels={overviewPanelLabels}
            onMove={(panels, label, position, button) => move({ ...layout, panels }, label, position, panels.length, button)}
          />
        </div>
        <div className="flex shrink-0 justify-end">
          <Button type="button" variant="outline" onClick={() => {
            onChange(defaultOverviewLayout);
            setAnnouncement(t("Default layout restored."));
          }}>
            {t("Reset layout")}
          </Button>
        </div>
        <p role="status" className="sr-only">{announcement}</p>
      </DialogContent>
    </Dialog>
  );
}
