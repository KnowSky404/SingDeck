import { useState } from "react";
import { Code, ConnectError } from "@connectrpc/connect";
import { version } from "../../../package.json";
import { describeError } from "@/api/errors";
import { useWorkspace } from "@/app/context";
import { Notice, PageHeading, Panel } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DisplayPreferenceFiles } from "./display-preference-files";

function ClashMode() {
  const { session, snapshot, t } = useWorkspace();
  const [error, setError] = useState<string>();
  const [chooserOpen, setChooserOpen] = useState(false);
  const options = snapshot.clashModeOptions ?? [];
  const mode = snapshot.currentClashMode;
  const streamError = snapshot.streamErrors.clashMode;
  const ready = snapshot.serviceActionsReady && snapshot.loaded.clashMode && !streamError;
  const changing = snapshot.changingClashMode;
  async function changeMode(next: string) {
    setError(undefined);
    try {
      await session.setClashMode(next);
    } catch (caught) {
      const { code } = ConnectError.from(caught);
      if (code === Code.Canceled) return;
      setError(code === Code.DeadlineExceeded
        ? "The core did not confirm the requested mode."
        : describeError(caught));
    }
  }
  return (
    <Panel title="Clash Mode">
      <dl className="detail-list">
        <div>
          <dt>{t(ready ? "Current mode" : "Last reported mode")}</dt>
          <dd aria-live="polite">{mode ?? "—"}</dd>
        </div>
      </dl>
      <div className="button-row">
        <Select
          open={chooserOpen && !changing}
          onOpenChange={(open) => {
            if (!open || !changing) setChooserOpen(open);
          }}
          value={mode && options.includes(mode) ? mode : ""}
          onValueChange={changing ? undefined : changeMode}
          disabled={!ready || !options.length}
        >
          <SelectTrigger
            aria-label={t("Change Clash Mode")}
            aria-disabled={changing || undefined}
            className="max-w-full *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:overflow-hidden aria-disabled:opacity-50"
          >
            <SelectValue placeholder={t("Change Clash Mode")} />
          </SelectTrigger>
          <SelectContent position="popper" className="max-w-(--radix-select-content-available-width)">
            {options.map((name) => (
              <SelectItem key={name} value={name} className="wrap-anywhere">
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {changing ? (
          <span role="status" className="footnote">{t("Waiting for mode confirmation…")}</span>
        ) : !ready && !streamError ? (
          <span role="status" className="footnote">{t("Waiting for live mode…")}</span>
        ) : null}
      </div>
      {streamError ? (
        <Notice title="Clash Mode unavailable">
          {t(streamError)} {t("Retained data may be stale.")}
        </Notice>
      ) : error && <Notice title="Clash Mode change failed">{error}</Notice>}
    </Panel>
  );
}

export default function Settings() {
  const { profile, snapshot, t } = useWorkspace();
  return (
    <>
      <PageHeading title={t("Settings")} />
      <div className="settings-grid">
        <Panel title={t("Instance details")}>
          <dl className="detail-list">
            <div>
              <dt>{t("API endpoint")}</dt>
              <dd>
                {profile.mode === "mock"
                  ? t("Demo workspace")
                  : profile.endpoint}
              </dd>
            </div>
            <div>
              <dt>{t("Core version")}</dt>
              <dd>{snapshot.version?.version ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("API version")}</dt>
              <dd>{snapshot.version?.apiVersion ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("Transport")}</dt>
              <dd>gRPC-Web</dd>
            </div>
          </dl>
        </Panel>
        <Panel title={t("Dashboard compatibility")}>
          <dl className="detail-list">
            <div>
              <dt>{t("Dashboard")}</dt>
              <dd>{version}</dd>
            </div>
            <div>
              <dt>{t("Supported API")}</dt>
              <dd>4</dd>
            </div>
            <div>
              <dt>{t("Core baseline")}</dt>
              <dd>1.14.0+</dd>
            </div>
          </dl>
          <div className="button-row">
            <Button variant="outline" asChild>
              <a
                href="https://github.com/KnowSky404/SingDeck/releases/latest"
                target="_blank"
                rel="noreferrer"
              >
                {t("Download dashboard")}
              </a>
            </Button>
            <Button variant="link" asChild>
              <a
                href="https://github.com/KnowSky404/SingDeck/blob/main/docs/deployment.md"
                target="_blank"
                rel="noreferrer"
              >
                {t("Local deployment guide")}
              </a>
            </Button>
          </div>
        </Panel>
        <DisplayPreferenceFiles />
        {snapshot.capabilities.clashMode.status === "supported" && <ClashMode />}
        {profile.mode === "native" && (
          <Panel title="Native services">
            {snapshot.capabilities.usbip.status === "unavailable" ||
            snapshot.capabilities.usbip.status === "unsupported" ? (
              <p>{t("USB/IP status is unavailable on this instance.")}</p>
            ) : (
              <div className="button-row">
                <Button variant="outline" asChild>
                  <a href="#/settings/usbip">{t("USB/IP server status")}</a>
                </Button>
              </div>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
