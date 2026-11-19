import { ArrowUpRight, Info, Layers3 } from "lucide-react";
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
import { version } from "../../package.json";

export function AboutDialog() {
  const { t } = useWorkspace();
  const title = t("About SingDeck");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={title} title={title}>
          <Info aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent
        closeLabel={t("Close")}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader className="flex-row items-center gap-3 pr-8">
          <span className="brand-mark" aria-hidden="true">
            <Layers3 />
          </span>
          <div className="flex min-w-0 flex-col gap-1 wrap-anywhere">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {t("Dashboard version {version}", { version: `v${version}` })}
            </DialogDescription>
          </div>
        </DialogHeader>
        <dl className="detail-list about-details rounded-lg border px-3 [&_dt]:shrink-0">
          <div>
            <dt>{t("Author")}</dt>
            <dd>
              <Button
                variant="link"
                size="sm"
                className="h-auto min-h-7 whitespace-normal"
                asChild
              >
                <a
                  href="https://github.com/KnowSky404"
                  target="_blank"
                  rel="noreferrer"
                >
                  KnowSky404
                  <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
                  <span className="sr-only">{t("(opens in a new tab)")}</span>
                </a>
              </Button>
            </dd>
          </div>
          <div>
            <dt>{t("Repository")}</dt>
            <dd>
              <Button
                variant="link"
                size="sm"
                className="h-auto min-h-7 whitespace-normal"
                asChild
              >
                <a
                  href="https://github.com/KnowSky404/SingDeck"
                  target="_blank"
                  rel="noreferrer"
                >
                  KnowSky404/SingDeck
                  <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
                  <span className="sr-only">{t("(opens in a new tab)")}</span>
                </a>
              </Button>
            </dd>
          </div>
        </dl>
      </DialogContent>
    </Dialog>
  );
}
